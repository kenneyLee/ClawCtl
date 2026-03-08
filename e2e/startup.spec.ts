import { test, expect } from "@playwright/test";

test.describe("Startup", () => {
  test("loads the app and shows ClawCtl", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/ClawCtl/);
  });

  test("shows Dashboard heading", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("sidebar is visible with navigation items", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sessions" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Security" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tools" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });
});
