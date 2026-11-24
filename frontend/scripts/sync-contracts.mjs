#!/usr/bin/env node
// Pulls ABIs + deployed addresses from ../contracts into src/contracts/.
// Usage: from the `frontend/` dir, run `npm run sync:contracts`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const contractsDir = path.join(repoRoot, "contracts");
const outDir = process.env.FORGE_OUT ? path.resolve(process.env.FORGE_OUT) : path.join(contractsDir, "out");
const deploymentsDir = path.join(contractsDir, "deployments");
const destDir = path.join(__dirname, "..", "src", "contracts");

const wanted = ["ProjectRegistry", "CarbonCredit", "Marketplace", "OffsetRouter"];

fs.mkdirSync(destDir, { recursive: true });

function extractAbi(name) {
  const artifactPath = path.join(outDir, `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    console.warn(`[sync-contracts] missing artifact: ${artifactPath}`);
    return null;
  }
  const json = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return json.abi;
}

const abis = {};
for (const name of wanted) {
  const abi = extractAbi(name);
  if (abi) {
    abis[name] = abi;
    fs.writeFileSync(
      path.join(destDir, `${name}.abi.json`),
      JSON.stringify(abi, null, 2) + "\n",
    );
  }
}

// Merge all known deployments into a single addresses.json keyed by chainId.
const addresses = {};
if (fs.existsSync(deploymentsDir)) {
  for (const file of fs.readdirSync(deploymentsDir)) {
    if (!file.endsWith(".json")) continue;
    const chainId = Number(file.replace(".json", ""));
    const dep = JSON.parse(fs.readFileSync(path.join(deploymentsDir, file), "utf8"));
    addresses[chainId] = {
      projectRegistry: dep.projectRegistry,
      carbonCredit: dep.carbonCredit,
      marketplace: dep.marketplace,
      offsetRouter: dep.offsetRouter,
    };
  }
}
fs.writeFileSync(
  path.join(destDir, "addresses.json"),
  JSON.stringify(addresses, null, 2) + "\n",
);

console.log("[sync-contracts] wrote:");
for (const n of Object.keys(abis)) console.log(`  src/contracts/${n}.abi.json`);
console.log(`  src/contracts/addresses.json (${Object.keys(addresses).length} chain(s))`);
