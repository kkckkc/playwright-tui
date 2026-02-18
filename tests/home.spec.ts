import { test, expect } from "@playwright/test";

test.describe("Home page", () => {
  test("has correct title", async ({ page }) => {
    await page.goto("https://playwright.dev/");
    await expect(page).toHaveTitle(/Playwright/);
  });

  test("get started link is visible", async ({ page }) => {
    await page.goto("https://playwright.dev/");
    const link = page.getByRole("link", { name: "Get started" });
    await expect(link).toBeVisible();
  });

  test("navigation links are present", async ({ page }) => {
    await page.goto("https://playwright.dev/");
    await expect(page.getByRole("link", { name: "Docs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "API" })).toBeVisible();
  });
});
