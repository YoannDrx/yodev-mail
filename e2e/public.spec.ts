import { expect, test } from "@playwright/test";

test("landing page exposes the transactional private-beta promise", async ({ page }) => {
  const response = await page.goto("/fr");
  expect(response?.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(response?.headers()["content-security-policy"]).toContain("object-src 'none'");
  await expect(page.getByRole("heading", { name: /Vos emails transactionnels/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Candidater à la bêta/ }).first()).toBeVisible();
  await expect(page.getByText("1 / requête")).toBeVisible();
  await expect(page.getByText("Tracking", { exact: true })).toBeVisible();
  await expect(page.getByText("Désactivé", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/fr$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
});

test("English pages and the language selector preserve the current route", async ({ page }) => {
  await page.goto("/en/fonctionnalites?source=language-test");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: /Transactional delivery/ })).toBeVisible();
  await page.getByRole("link", { name: "FR" }).click();
  await expect(page).toHaveURL(/\/fr\/fonctionnalites\?source=language-test$/);
  await expect(page.getByRole("heading", { name: /La livraison transactionnelle/ })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/fr$/);
});

test("language negotiation respects Accept-Language", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByRole("heading", { name: /Your transactional emails/ })).toBeVisible();
  await context.close();
});

test("every public and authentication page renders in both languages", async ({ request }) => {
  test.setTimeout(120_000);
  const paths = [
    "",
    "/fonctionnalites",
    "/tarifs",
    "/delivrabilite",
    "/conformite",
    "/docs",
    "/anti-abus",
    "/confidentialite",
    "/cgu",
    "/mentions-legales",
    "/dpa",
    "/sous-traitants",
    "/sla",
    "/connexion?configuration=requise",
    "/inscription",
    "/mot-de-passe-oublie",
    "/reinitialiser-mot-de-passe?token=test-reset-token",
    "/invitation?id=00000000-0000-0000-0000-000000000000",
  ];
  for (const locale of ["fr", "en"] as const) {
    for (const path of paths) {
      const response = await request.get(`/${locale}${path}`);
      expect(response.ok(), `${locale}${path} should render`).toBeTruthy();
      expect(await response.text()).toContain(`<html lang="${locale}"`);
    }
  }
});

test("private dashboard redirects anonymous visitors to Better Auth", async ({ page }) => {
  await page.goto("/fr/dashboard");
  await expect(page).toHaveURL(/\/connexion\?configuration=requise/);
  await expect(page.getByRole("heading", { name: "Console en cours de configuration" })).toBeVisible();
  const retiredContacts = await page.goto("/dashboard/contacts");
  expect(retiredContacts?.status()).toBe(404);
});

test("retired unsubscribe routes are unavailable", async ({ request }) => {
  const response = await request.get("/u/legacy");
  expect(response.status()).toBe(404);
});

test("OpenAPI publishes only the strict provider-neutral contract", async ({ request }) => {
  const response = await request.get("/openapi.json");
  expect(response.ok()).toBeTruthy();
  const spec = await response.json();
  expect(spec.servers).toEqual([{ url: "https://api.mail.yodev.fr" }]);
  expect(spec.paths).toHaveProperty("/v1/emails");
  expect(spec.paths).toHaveProperty("/v1/attachments");
  expect(JSON.stringify(spec)).not.toMatch(/vigie|campaign|newsletter|unsubscribe/i);
});

test("health endpoint remains useful before database provisioning", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBeTruthy();
  expect(await response.json()).toMatchObject({ status: "ok", database: "unconfigured" });
});
