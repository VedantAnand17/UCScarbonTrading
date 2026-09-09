const { createPublicClient, createWalletClient, http, parseAbi, decodeEventLog } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { sepolia } = require("viem/chains");

// Deployed addresses from README.md (Sepolia). Override via env if you
// redeploy — never hardcode a different chain's addresses here.
const CARBON_CREDIT_ADDRESS =
  process.env.CARBON_CREDIT_ADDRESS || "0x84aA28FFd384B6503a4A29CB998dD36DcfcDf140";
const PROJECT_REGISTRY_ADDRESS =
  process.env.PROJECT_REGISTRY_ADDRESS || "0x311F2F7bF8A3b3346a6709C8e247CA9d2fEe4d39";

const carbonCreditAbi = parseAbi([
  "function issue(uint256 projectId, address to, uint256 amount) external",
  "event CreditsIssued(uint256 indexed projectId, address indexed to, uint256 amount)",
]);

const projectRegistryAbi = parseAbi([
  "function registerProject(address developer, string name, string location, string methodology, uint16 vintageYear, string metadataURI) external returns (uint256 id)",
  "event ProjectRegistered(uint256 indexed id, address indexed developer, string name, uint16 vintageYear, string metadataURI)",
]);

function getAccount() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    throw new Error(
      "PRIVATE_KEY not set in backend/.env — this must be the CarbonCredit contract owner's key"
    );
  }
  return privateKeyToAccount(pk);
}

function getClients() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const transport = http(rpcUrl);
  const account = getAccount();

  const publicClient = createPublicClient({ chain: sepolia, transport });
  const walletClient = createWalletClient({ account, chain: sepolia, transport });

  return { publicClient, walletClient, account };
}

// Mints `amount` whole credits (uint256, no decimals — see backend/README.md
// on why this is amplified for demo readings) for `projectId` to `to`.
// Waits for the transaction to confirm before returning, so callers know
// definitively whether the mint landed on-chain.
async function mintCredits({ projectId, to, amount }) {
  const { publicClient, walletClient, account } = getClients();

  const hash = await walletClient.writeContract({
    address: CARBON_CREDIT_ADDRESS,
    abi: carbonCreditAbi,
    functionName: "issue",
    args: [BigInt(projectId), to, BigInt(amount)],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`mint tx ${hash} reverted`);
  }

  return { txHash: hash };
}

// One-off helper for scripts/register-project.js — not called from the
// ingestion request path.
async function registerProject({ developer, name, location, methodology, vintageYear, metadataURI }) {
  const { publicClient, walletClient, account } = getClients();

  const hash = await walletClient.writeContract({
    address: PROJECT_REGISTRY_ADDRESS,
    abi: projectRegistryAbi,
    functionName: "registerProject",
    args: [developer, name, location, methodology, vintageYear, metadataURI],
    account,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`registerProject tx ${hash} reverted`);
  }

  const log = receipt.logs.find(
    (l) => l.address.toLowerCase() === PROJECT_REGISTRY_ADDRESS.toLowerCase()
  );

  let projectId;
  if (log) {
    const decoded = decodeEventLog({ abi: projectRegistryAbi, data: log.data, topics: log.topics });
    if (decoded.eventName === "ProjectRegistered") {
      projectId = decoded.args.id;
    }
  }

  return { txHash: hash, projectId };
}

module.exports = { mintCredits, registerProject, CARBON_CREDIT_ADDRESS, PROJECT_REGISTRY_ADDRESS };
