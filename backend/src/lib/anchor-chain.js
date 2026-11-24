const { createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi, stringToHex, zeroHash } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");

const abi = parseAbi([
  "function anchor(bytes32 tradeId, bytes32 tradeHash)",
  "function tradeHashes(bytes32 tradeId) view returns (bytes32)",
  "event TradeAnchored(bytes32 indexed tradeId, bytes32 tradeHash)",
]);
const event = abi[2];

function anchorChain() {
  const { ANCHOR_RPC_URL: rpcUrl, TRADE_ANCHOR_ADDRESS: contractAddress } = process.env;
  if (!rpcUrl || !contractAddress) return null;
  const address = getAddress(contractAddress);
  const transport = http(rpcUrl, { timeout: 8000, retryCount: 1 });
  const publicClient = createPublicClient({ transport });
  return { address, transport, publicClient };
}

const chainTradeId = (tradeId) => keccak256(stringToHex(tradeId));

async function readAnchoredHash(chain, tradeId) {
  const hash = await chain.publicClient.readContract({
    address: chain.address, abi, functionName: "tradeHashes", args: [chainTradeId(tradeId)],
  });
  return hash === zeroHash ? null : hash;
}

function anchorWallet(chain) {
  const account = privateKeyToAccount(process.env.ANCHOR_PRIVATE_KEY);
  return createWalletClient({ account, transport: chain.transport });
}

module.exports = { abi, event, anchorChain, chainTradeId, readAnchoredHash, anchorWallet };
