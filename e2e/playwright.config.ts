import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: "http://localhost:7101",
    headless: true,
    storageState: "e2e/.auth-state.json",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:7101",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
