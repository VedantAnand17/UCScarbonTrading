import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { demoSeedStatements } from "./seed-data.ts";

if (existsSync(".dev.vars")) process.loadEnvFile(".dev.vars");
const key = process.env.DEVICE_SECRET_ENCRYPTION_KEY;
if (!/^[a-f0-9]{64}$/i.test(key ?? "")) {
  throw new Error("Set DEVICE_SECRET_ENCRYPTION_KEY to the target Worker's 64-character hex key");
}
const statements = await demoSeedStatements(key);
await writeFile("demo-seed.sql", statements.join("\n") + "\n", { mode: 0o600 });
console.log("Wrote demo-seed.sql with three organisations, two meters, 1,008 readings, and three settled trades.");
