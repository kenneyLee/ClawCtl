import { request } from "@playwright/test";

const BASE = "http://localhost:7101";
const STORAGE_STATE = "e2e/.auth-state.json";

/**
 * Global setup: ensure an admin account exists and save authenticated state.
 * Runs once before all E2E tests.
 */
async function globalSetup() {
  const ctx = await request.newContext({ baseURL: BASE });

  // Check if setup is needed
  const statusRes = await ctx.get("/api/auth/status");
  const { needsSetup } = await statusRes.json();

  if (needsSetup) {
    // First run — create admin account
    await ctx.post("/api/auth/setup", {
      data: { username: "admin", password: "admin123" },
    });
  } else {
    // Login with existing account
    await ctx.post("/api/auth/login", {
      data: { username: "admin", password: "admin123" },
    });
  }

  // Save storage state (cookies) for all tests
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();
}

export default globalSetup;
