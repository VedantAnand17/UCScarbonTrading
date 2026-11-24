import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: "./wrangler.toml" },
    miniflare: {
      bindings: {
        JWT_SECRET: "test-only-jwt-secret-at-least-32-bytes",
        DEVICE_SECRET_ENCRYPTION_KEY: "ab".repeat(32),
        TEST_MIGRATIONS: await readD1Migrations("./migrations"),
      },
    },
  })],
  test: { globalSetup: ["./test/anvil.ts"], testTimeout: 65000 },
});
