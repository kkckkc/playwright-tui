import { test, expect } from "@playwright/test";

test.describe("Search functionality", () => {
  test("search button is available", async ({ page }) => {
    await page.goto("https://playwright.dev/");
    const searchBtn = page.getByRole("button", { name: /search/i });
    await expect(searchBtn).toBeVisible();
  });

  test("intentionally failing test", async ({ page }) => {
    await page.goto("https://playwright.dev/");
    // This test will fail to demonstrate failure display in the TUI
    await expect(page.getByText("This text does not exist on the page")).toBeVisible();
  });
});
