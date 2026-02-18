import { test, expect } from "@playwright/test";

test.describe("API docs", () => {
  test("API page loads", async ({ page }) => {
    await page.goto("https://playwright.dev/docs/api/class-playwright");
    await expect(page).toHaveTitle(/Playwright/);
  });

  test("Playwright class is documented", async ({ page }) => {
    await page.goto("https://playwright.dev/docs/api/class-playwright");
    await expect(page.getByRole("heading", { name: /Playwright/i }).first()).toBeVisible();
  });
});
