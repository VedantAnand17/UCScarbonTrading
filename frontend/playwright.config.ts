import { defineConfig } from "@playwright/test";

const baseURL = "http://localhost:5183";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "phone", use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true } },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    env: { VITE_MOCK_API: "true", VITE_API_URL: "" },
    reuseExistingServer: !process.env.CI,
  },
});
