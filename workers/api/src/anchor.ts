import { BaseError, parseEventLogs, TransactionNotFoundError, type Hex } from "viem";
import { abi, anchorChain, anchorWallet, chainTradeId, event, readAnchoredHash, type AnchorChain } from "./anchor-chain";
import { sql } from "./http";

const MAX_ATTEMPTS = 5;
const LEASE_MS = 120_000;
const LOG_RANGE = 2_000n;

type Lease = {
  id: string; tradeId: string; tradeHash: Hex; txHash: Hex | null; firstBlock: string | null;
  attempts: number; nextAttemptAt: string; leaseId: string;
};
type Proof = { txHash: Hex; blockNumber: bigint };
type Wallet = ReturnType<typeof anchorWallet>;

async function claim(db: D1Database) {
  const now = new Date();
  const leaseId = crypto.randomUUID();
  const [claimed] = await db.batch<Lease>([
    sql(db, `UPDATE Anchor SET status = 'INFLIGHT', attempts = attempts + 1, leaseId = ?2,
      nextAttemptAt = ?3, updatedAt = ?1
      WHERE id = (
        SELECT id FROM Anchor WHERE nextAttemptAt <= ?1
          AND (status IN ('PENDING', 'INFLIGHT') OR (status = 'FAILED' AND attempts < ?4))
        ORDER BY nextAttemptAt, id LIMIT 1
      )
      AND NOT EXISTS (SELECT 1 FROM Anchor WHERE status = 'INFLIGHT' AND nextAttemptAt > ?1)
      RETURNING id, tradeId, (SELECT tradeHash FROM Trade WHERE id = tradeId) AS tradeHash,
        txHash, CAST(firstBlock AS TEXT) AS firstBlock, attempts, nextAttemptAt, leaseId`,
    now.toISOString(), leaseId, new Date(now.getTime() + LEASE_MS).toISOString(), MAX_ATTEMPTS),
    sql(db, `UPDATE Trade SET status = 'ANCHOR_PENDING' WHERE status IN ('SETTLED', 'ANCHOR_FAILED')
      AND id = (SELECT tradeId FROM Anchor WHERE leaseId = ?) AND changes() = 1`, leaseId),
  ]);
  return claimed.results[0];
}

async function saveProgress(db: D1Database, lease: Lease, column: "txHash" | "firstBlock", value: string | null) {
  const assignment = column === "firstBlock" ? "firstBlock = CAST(?1 AS INTEGER)" : "txHash = ?1";
  const now = new Date().toISOString();
  const { meta } = await sql(db, `UPDATE Anchor SET ${assignment}, updatedAt = ?2
    WHERE id = ?3 AND status = 'INFLIGHT' AND leaseId = ?4 AND nextAttemptAt > ?2`,
  value, now, lease.id, lease.leaseId).run();
  if (!meta.changes) throw new Error("anchor lease expired");
}

async function recoverEvent(chain: AnchorChain, lease: Lease, deploymentBlock: bigint): Promise<Proof> {
  const firstBlock = lease.firstBlock === null ? deploymentBlock : BigInt(lease.firstBlock);
  const args = { tradeId: chainTradeId(lease.tradeId) };
  for (let toBlock = await chain.publicClient.getBlockNumber({ cacheTime: 0 }); toBlock >= firstBlock;) {
    const from = toBlock - LOG_RANGE + 1n;
    const fromBlock = from > firstBlock ? from : firstBlock;
    const logs = await chain.publicClient.getLogs({ address: chain.address, event, args, fromBlock, toBlock, strict: true });
    const log = logs.find((entry) => entry.args.tradeHash === lease.tradeHash);
    if (log) return { txHash: log.transactionHash, blockNumber: log.blockNumber };
    toBlock = fromBlock - 1n;
  }
  throw new Error("anchored hash exists, but its event could not be located");
}

async function awaitReceipt(db: D1Database, chain: AnchorChain, lease: Lease, hash: Hex): Promise<Proof> {
  let receipt;
  try {
    receipt = await chain.publicClient.waitForTransactionReceipt({ hash, timeout: 40_000 });
  } catch (error) {
    // Keep following a transaction the RPC still knows, and allow a dropped one to be sent again.
    try {
      await chain.publicClient.getTransaction({ hash });
    } catch (lookupError) {
      if (lookupError instanceof TransactionNotFoundError) await saveProgress(db, lease, "txHash", null);
    }
    throw error;
  }
  const logs = parseEventLogs({ abi: [event], logs: receipt.logs, strict: true });
  const id = chainTradeId(lease.tradeId);
  const anchored = logs.some((log) => log.address.toLowerCase() === chain.address.toLowerCase() &&
    log.args.tradeId === id && log.args.tradeHash === lease.tradeHash);
  if (receipt.status !== "success" || !anchored) {
    await saveProgress(db, lease, "txHash", null);
    throw new Error("transaction did not emit the expected TradeAnchored event");
  }
  return { txHash: receipt.transactionHash, blockNumber: receipt.blockNumber };
}

async function submitOrRecover(db: D1Database, chain: AnchorChain, wallet: Wallet, lease: Lease, deploymentBlock: bigint) {
  const existing = await readAnchoredHash(chain, lease.tradeId);
  if (existing) {
    if (existing !== lease.tradeHash) throw new Error("on-chain hash does not match the settled trade");
    return recoverEvent(chain, lease, deploymentBlock);
  }
  if (lease.txHash) return awaitReceipt(db, chain, lease, lease.txHash);
  if (lease.attempts > MAX_ATTEMPTS) throw new Error("anchor retry limit reached");
  if (lease.firstBlock === null) {
    const firstBlock = await chain.publicClient.getBlockNumber({ cacheTime: 0 });
    await saveProgress(db, lease, "firstBlock", firstBlock.toString());
  }
  if (Date.now() >= Date.parse(lease.nextAttemptAt)) throw new Error("anchor lease expired before submission");
  // viem estimates gas through the configured node.
  const hash = await wallet.writeContract({
    address: chain.address, abi, functionName: "anchor", chain: null, args: [chainTradeId(lease.tradeId), lease.tradeHash],
  });
  await saveProgress(db, lease, "txHash", hash);
  return awaitReceipt(db, chain, lease, hash);
}

async function recordOutcome(db: D1Database, lease: Lease, proof: Proof | null, error: string | null) {
  const now = Date.now();
  const backoffMs = Math.min(30_000 * 2 ** (lease.attempts - 1), 15 * 60_000);
  await db.batch([
    sql(db, `UPDATE Anchor SET status = ?, txHash = COALESCE(?, txHash), blockNumber = CAST(? AS INTEGER), lastError = ?,
      updatedAt = ?, nextAttemptAt = ?, leaseId = NULL
      WHERE id = ? AND status = 'INFLIGHT' AND leaseId = ?`,
    proof ? "CONFIRMED" : "FAILED", proof?.txHash ?? null, proof?.blockNumber.toString() ?? null, error,
    new Date(now).toISOString(), new Date(now + (proof ? 0 : backoffMs)).toISOString(), lease.id, lease.leaseId),
    sql(db, "UPDATE Trade SET status = ? WHERE id = ? AND status <> 'ANCHORED' AND changes() = 1",
      proof ? "ANCHORED" : "ANCHOR_FAILED", lease.tradeId),
  ]);
}

export async function processAnchors(env: Env) {
  const chain = anchorChain(env);
  if (!chain) return;
  const wallet = anchorWallet(chain, env.ANCHOR_PRIVATE_KEY);
  const deploymentBlock = BigInt(env.ANCHOR_DEPLOYMENT_BLOCK || "0");
  if (deploymentBlock < 0n) throw new Error("ANCHOR_DEPLOYMENT_BLOCK must be nonnegative");
  const deadline = Date.now() + 45_000;
  for (let count = 0; count < 8 && Date.now() < deadline; count++) {
    const lease = await claim(env.DB);
    if (!lease) return;
    let proof: Proof;
    try {
      proof = await submitOrRecover(env.DB, chain, wallet, lease, deploymentBlock);
    } catch (error) {
      const message = (error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error))
        .split("\n", 1)[0].slice(0, 500);
      await recordOutcome(env.DB, lease, null, message);
      console.error("Anchor attempt failed", { tradeId: lease.tradeId, attempts: lease.attempts, message });
      continue;
    }
    await recordOutcome(env.DB, lease, proof, null);
  }
}
