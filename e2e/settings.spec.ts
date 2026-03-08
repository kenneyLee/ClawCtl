import { test, expect } from "@playwright/test";

test.describe("Settings page", () => {
  test("shows LLM configuration form", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("LLM Configuration")).toBeVisible();
    await expect(page.getByText("Provider")).toBeVisible();
    await expect(page.getByText("Save")).toBeVisible();
  });

  test("provider selector has 3 options", async ({ page }) => {
    await page.goto("/settings");
    // Wait for page to fully load, then find the provider select by its value
    await expect(page.getByText("LLM Configuration")).toBeVisible();
    const select = page.locator("select").filter({ has: page.locator("option[value='openai']") });
    const options = await select.locator("option").allTextContents();
    expect(options).toContain("OpenAI");
    expect(options).toContain("Anthropic");
    expect(options).toContain("Ollama (local)");
  });
});
