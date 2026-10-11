import { expect, test } from "@playwright/test";

test.describe("localized not-found pages", () => {
  test("French 404 with navigation back", async ({ page }) => {
    const response = await page.goto("/fr/inexistant");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1, name: "Page introuvable" })).toBeVisible();
    await expect(page.getByText("404", { exact: true })).toBeVisible();
    await expect(page).toHaveTitle(/Page introuvable/);
    const navigation = page.getByRole("navigation", { name: "Pages utiles" });
    await expect(navigation.getByRole("link", { name: "Accueil" })).toHaveAttribute("href", "/fr");
    await expect(navigation.getByRole("link", { name: "Documentation de l’API" })).toHaveAttribute("href", "/fr/docs");
    await navigation.getByRole("link", { name: "Accueil" }).click();
    await expect(page).toHaveURL(/\/fr$/);
  });

  test("English 404 on the English prefix", async ({ page }) => {
    const response = await page.goto("/en/does-not-exist/at-all");
    expect(response?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle(/Page not found/);
    await expect(page.getByRole("navigation", { name: "Useful pages" }).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/en");
    await expect(page.getByText("Page introuvable")).toHaveCount(0);
  });
});
