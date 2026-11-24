import { createPublicClient, createWalletClient, getAddress, http, keccak256, parseAbi, stringToHex, zeroHash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const abi = parseAbi([
  "function anchor(bytes32 tradeId, bytes32 tradeHash)",
  "function tradeHashes(bytes32 tradeId) view returns (bytes32)",
  "event TradeAnchored(bytes32 indexed tradeId, bytes32 tradeHash)",
]);
export const event = abi[2];

export function anchorChain(env: Env) {
  if (!env.ANCHOR_RPC_URL || !env.TRADE_ANCHOR_ADDRESS) return null;
  const address = getAddress(env.TRADE_ANCHOR_ADDRESS);
  const transport = http(env.ANCHOR_RPC_URL, { timeout: 8000, retryCount: 1 });
  return { address, transport, publicClient: createPublicClient({ transport }) };
}

export type AnchorChain = NonNullable<ReturnType<typeof anchorChain>>;
export const chainTradeId = (id: string) => keccak256(stringToHex(id));

export async function readAnchoredHash(chain: AnchorChain, id: string) {
  const hash = await chain.publicClient.readContract({
    address: chain.address, abi, functionName: "tradeHashes", args: [chainTradeId(id)],
  });
  return hash === zeroHash ? null : hash;
}

export function anchorWallet(chain: AnchorChain, privateKey: string) {
  if (!/^0x[a-f0-9]{64}$/i.test(privateKey)) throw new Error("ANCHOR_PRIVATE_KEY must be a 0x-prefixed 32-byte hex key");
  const account = privateKeyToAccount(privateKey as Hex);
  return createWalletClient({ account, transport: chain.transport });
}
