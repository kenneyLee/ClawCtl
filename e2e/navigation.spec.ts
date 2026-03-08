import { test, expect } from "@playwright/test";

const pages = [
  { nav: "Sessions", heading: "Sessions" },
  { nav: "Usage", heading: "Usage" },
  { nav: "Security", heading: "Security Posture" },
  { nav: "Config", heading: "Config Management" },
  { nav: "Tools", heading: "Tool Diagnostics" },
  { nav: "Operations", heading: "Operation Center" },
  { nav: "Settings", heading: "Settings" },
];

test.describe("Navigation", () => {
  for (const { nav, heading } of pages) {
    test(`navigates to ${nav} page`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("link", { name: nav }).click();
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    });
  }

  test("navigates back to Dashboard", async ({ page }) => {
    await page.goto("/sessions");
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });
});
