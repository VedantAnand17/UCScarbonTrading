import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { once } from "node:events";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import type { TestProject } from "vitest/node";
import { createPublicClient, createTestClient, http, parseEther, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const exec = promisify(execFile);
const contracts = fileURLToPath(new URL("../../../contracts", import.meta.url));

declare module "vitest" {
  export interface ProvidedContext {
    anvil: { rpcUrl: string; address: Address; block: string; privateKey: Hex };
  }
}

export default async function setup(project: TestProject) {
  const socket = createServer().listen(0, "127.0.0.1");
  await once(socket, "listening");
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a port for Anvil");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));

  const rpcUrl = `http://127.0.0.1:${address.port}`;
  const chain = spawn("anvil", ["--host", "127.0.0.1", "--port", String(address.port), "--silent"], { stdio: "ignore" });
  await once(chain, "spawn");
  const transport = http(rpcUrl, { retryCount: 0 });
  const client = createPublicClient({ transport });
  try {
    const deadline = Date.now() + 5000;
    for (;;) {
      try {
        if (await client.getChainId() === 31337) break;
      } catch (error) {
        if (chain.exitCode !== null || Date.now() >= deadline) throw error;
      }
      if (Date.now() >= deadline) throw new Error("Anvil did not start");
      await setTimeout(50);
    }
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const anvil = createTestClient({ mode: "anvil", transport });
    await anvil.setBalance({ address: account.address, value: parseEther("10") });
    const { stdout } = await exec("forge", [
      "create", "src/TradeAnchor.sol:TradeAnchor", "--rpc-url", rpcUrl, "--private-key", privateKey,
      "--broadcast", "--json", "--constructor-args", account.address,
    ], { cwd: contracts, timeout: 60_000 });
    const deployment = JSON.parse(stdout) as { deployedTo: Address; transactionHash: Address };
    const { blockNumber, status } = await client.waitForTransactionReceipt({ hash: deployment.transactionHash });
    if (status !== "success") throw new Error("TradeAnchor deployment failed");
    project.provide("anvil", { rpcUrl, address: deployment.deployedTo, block: blockNumber.toString(), privateKey });
    return () => { chain.kill(); };
  } catch (error) {
    chain.kill();
    throw error;
  }
}
