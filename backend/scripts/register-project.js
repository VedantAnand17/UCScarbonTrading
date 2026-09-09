// One-off script: registers a new project on ProjectRegistry (Sepolia)
// so a real device's readings have somewhere to mint into. Requires
// PRIVATE_KEY (the contract owner's key) set in backend/.env.
//
// Usage:
//   node scripts/register-project.js "<name>" "<location>" "<developerAddress>"
//
// Prints the new numeric project id — pass that + the developer address
// to POST /api/v1/admin/devices/:deviceId/rebind to bind a device to it.

require("dotenv").config();
const { registerProject } = require("../src/lib/chain");

async function main() {
  const [name, location, developer] = process.argv.slice(2);

  if (!name || !location || !developer) {
    console.error('Usage: node scripts/register-project.js "<name>" "<location>" "<developerAddress>"');
    process.exit(1);
  }

  console.log("Registering project on Sepolia...");
  const { txHash, projectId } = await registerProject({
    developer,
    name,
    location,
    methodology: "Direct metering (ESP32 + Modbus energy meter)",
    vintageYear: new Date().getFullYear(),
    metadataURI: "",
  });

  console.log("tx:", txHash);
  console.log("project id:", projectId?.toString());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
