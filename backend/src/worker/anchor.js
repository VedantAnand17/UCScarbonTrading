require("dotenv").config();
const { setTimeout: wait } = require("node:timers/promises");
const { parseEventLogs, TransactionNotFoundError } = require("viem");
const prisma = require("../lib/prisma");
const { abi, event, anchorChain, anchorWallet, chainTradeId, readAnchoredHash } = require("../lib/anchor-chain");

const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;
const POLL_MS = 5_000;
const LOG_RANGE = 2_000n;

async function claim() {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const [candidate] = await tx.$queryRaw`
      SELECT id FROM "Anchor" WHERE "nextAttemptAt" <= ${now}
      AND (status IN ('PENDING', 'INFLIGHT') OR (status = 'FAILED' AND attempts < ${MAX_ATTEMPTS}))
      ORDER BY "nextAttemptAt", id LIMIT 1 FOR UPDATE SKIP LOCKED`;
    if (!candidate) return null;
    const anchor = await tx.anchor.update({
      where: { id: candidate.id }, include: { trade: { select: { tradeHash: true } } },
      data: { status: "INFLIGHT", attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
    });
    await tx.trade.updateMany({
      where: { id: anchor.tradeId, status: { in: ["SETTLED", "ANCHOR_FAILED"] } }, data: { status: "ANCHOR_PENDING" },
    });
    return anchor;
  });
}

function ownedLease(anchor) {
  return { id: anchor.id, status: "INFLIGHT", attempts: anchor.attempts, nextAttemptAt: anchor.nextAttemptAt };
}

async function writeProgress(anchor, data) {
  const { count } = await prisma.anchor.updateMany({ where: ownedLease(anchor), data });
  if (count === 0) throw new Error("anchor lease expired");
}

async function recordOutcome(anchor, anchorData, tradeStatus) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.anchor.updateMany({ where: ownedLease(anchor), data: anchorData });
    if (count === 1) {
      await tx.trade.updateMany({
        where: { id: anchor.tradeId, status: { not: "ANCHORED" } }, data: { status: tradeStatus },
      });
    }
  });
}

async function recoverEvent(chain, anchor, deploymentBlock) {
  const { publicClient, address } = chain;
  const firstBlock = anchor.firstBlock ?? deploymentBlock;
  const args = { tradeId: chainTradeId(anchor.tradeId) };
  for (let toBlock = await publicClient.getBlockNumber({ cacheTime: 0 }); toBlock >= firstBlock;) {
    const from = toBlock - LOG_RANGE + 1n;
    const fromBlock = from > firstBlock ? from : firstBlock;
    const [log] = await publicClient.getLogs({ address, event, args, fromBlock, toBlock, strict: true });
    if (log) return { txHash: log.transactionHash, blockNumber: log.blockNumber };
    toBlock = fromBlock - 1n;
  }
  throw new Error("anchored hash exists, but its event could not be located");
}

async function waitForAnchorReceipt(chain, anchor, hash) {
  let receipt;
  try {
    receipt = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 40_000 });
  } catch (err) {
    // Keep following a transaction the RPC still knows. A dropped transaction can be sent again.
    try {
      await chain.publicClient.getTransaction({ hash });
    } catch (lookupError) {
      if (lookupError instanceof TransactionNotFoundError) await writeProgress(anchor, { txHash: null });
    }
    throw err;
  }
  const logs = parseEventLogs({ abi: [event], logs: receipt.logs, strict: true });
  const tradeId = chainTradeId(anchor.tradeId);
  const anchored = logs.some((log) => log.address.toLowerCase() === chain.address.toLowerCase() &&
    log.args.tradeId === tradeId && log.args.tradeHash === anchor.trade.tradeHash);
  if (receipt.status !== "success" || !anchored) {
    await writeProgress(anchor, { txHash: null });
    throw new Error("transaction did not emit the expected TradeAnchored event");
  }
  return { txHash: receipt.transactionHash, blockNumber: receipt.blockNumber };
}

async function submitOrRecover(chain, wallet, anchor, deploymentBlock) {
  const existing = await readAnchoredHash(chain, anchor.tradeId);
  if (existing) {
    if (existing !== anchor.trade.tradeHash) throw new Error("on-chain hash does not match the settled trade");
    return recoverEvent(chain, anchor, deploymentBlock);
  }
  if (anchor.txHash) return waitForAnchorReceipt(chain, anchor, anchor.txHash);
  if (anchor.attempts > MAX_ATTEMPTS) throw new Error("anchor retry limit reached");
  if (anchor.firstBlock === null) {
    const firstBlock = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    await writeProgress(anchor, { firstBlock });
  }
  if (Date.now() >= anchor.nextAttemptAt.getTime()) throw new Error("anchor lease expired before submission");
  const hash = await wallet.writeContract({
    address: chain.address, abi, functionName: "anchor", chain: null,
    args: [chainTradeId(anchor.tradeId), anchor.trade.tradeHash],
  });
  await writeProgress(anchor, { txHash: hash });
  return waitForAnchorReceipt(chain, anchor, hash);
}

async function processAnchor(chain, wallet, anchor, deploymentBlock) {
  try {
    const result = await submitOrRecover(chain, wallet, anchor, deploymentBlock);
    await recordOutcome(anchor, { ...result, status: "CONFIRMED", lastError: null, nextAttemptAt: new Date() }, "ANCHORED");
    console.log(`Anchored trade ${anchor.tradeId} in transaction ${result.txHash}, block ${result.blockNumber}`);
    return true;
  } catch (err) {
    const backoffMs = Math.min(30_000 * 2 ** (anchor.attempts - 1), 15 * 60_000);
    const lastError = (err.shortMessage || err.message.split("\n")[0]).slice(0, 500);
    await recordOutcome(anchor, {
      status: "FAILED", lastError, nextAttemptAt: new Date(Date.now() + backoffMs),
    }, "ANCHOR_FAILED");
    console.error(`Anchor attempt ${anchor.attempts} failed for trade ${anchor.tradeId}: ${lastError}`);
    return false;
  }
}

async function main() {
  const chain = anchorChain();
  if (!chain || !process.env.ANCHOR_PRIVATE_KEY) {
    throw new Error("Set ANCHOR_RPC_URL, ANCHOR_PRIVATE_KEY, and TRADE_ANCHOR_ADDRESS before starting the worker");
  }
  const wallet = anchorWallet(chain);
  const deploymentBlock = BigInt(process.env.ANCHOR_DEPLOYMENT_BLOCK || 0);
  if (deploymentBlock < 0n) throw new Error("ANCHOR_DEPLOYMENT_BLOCK must be nonnegative");
  const once = process.argv.includes("--once");
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  while (!stopping) {
    const anchor = await claim();
    if (anchor) {
      const confirmed = await processAnchor(chain, wallet, anchor, deploymentBlock);
      if (once && !confirmed) process.exitCode = 1;
    } else if (once) {
      return;
    } else {
      await wait(POLL_MS);
    }
  }
}

main().catch((err) => {
  console.error(`Anchor worker stopped: ${err.shortMessage || err.message.split("\n")[0]}`);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
