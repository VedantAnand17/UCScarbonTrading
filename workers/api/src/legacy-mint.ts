import { BaseError, createPublicClient, createWalletClient, getAddress, http, parseAbi, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { sql } from "./http";

type LegacyEnv = Env & { PRIVATE_KEY?: string };
type ProjectDevice = { projectId: number | null; generatorAddress: string | null };

const abi = parseAbi(["function issue(uint256 projectId, address to, uint256 amount) external"]);

export function legacyCredits(kwh: number, env: Env) {
  if (kwh <= 0) return 0;
  const tonnes = kwh * Number(env.EMISSION_FACTOR_KG_PER_KWH || 0.71) / 1000;
  return Math.max(Math.floor(tonnes * Number(env.DEMO_AMPLIFY || 100)), Number(env.DEMO_MIN_CREDITS ?? 1));
}

export async function recordLegacyMint(env: LegacyEnv, device: ProjectDevice, deviceId: string, seq: number, amount: number) {
  let txHash: Hex | null = null;
  let mintError: string | null = null;
  try {
    if (!device.projectId || !device.generatorAddress) throw new Error("device not bound to a project/generatorAddress");
    if (!env.PRIVATE_KEY || !/^0x[a-f0-9]{64}$/i.test(env.PRIVATE_KEY)) throw new Error("PRIVATE_KEY must be the CarbonCredit contract owner's key");
    const account = privateKeyToAccount(env.PRIVATE_KEY as Hex);
    const transport = http(env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
    const publicClient = createPublicClient({ chain: sepolia, transport });
    const wallet = createWalletClient({ account, chain: sepolia, transport });
    const hash = await wallet.writeContract({
      address: getAddress(env.CARBON_CREDIT_ADDRESS), abi, functionName: "issue",
      args: [BigInt(device.projectId), getAddress(device.generatorAddress), BigInt(amount)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`mint tx ${hash} reverted`);
    txHash = hash;
  } catch (error) {
    mintError = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : String(error);
  }
  await sql(env.DB, "UPDATE Reading SET mintStatus = ?, mintTxHash = ?, mintError = ? WHERE deviceId = ? AND seq = ?",
    txHash ? "success" : "failed", txHash, mintError, deviceId, seq).run();
}
