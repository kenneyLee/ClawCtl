import { test, expect } from "@playwright/test";

// Auth tests use their own context WITHOUT the global storageState,
// so they see the login page instead of the authenticated app.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Auth flow", () => {
  test("login page shows ClawCtl heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "ClawCtl" })).toBeVisible();
  });

  test("login page has username and password fields", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Username")).toBeVisible();
    await expect(page.getByText("Password")).toBeVisible();
  });

  test("login page has submit button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button")).toBeVisible();
  });

  test("login with valid credentials navigates to dashboard", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("textbox").first().fill("admin");
    await page.locator("input[type='password']").fill("admin123");
    await page.getByRole("button").click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 10000 });
  });
});
