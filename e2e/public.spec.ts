import { expect, test } from "@playwright/test";

test("landing page exposes the transactional private-beta promise", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Vos emails transactionnels/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Candidater à la bêta/ }).first()).toBeVisible();
  await expect(page.getByText("1 / requête")).toBeVisible();
  await expect(page.getByText("Tracking", { exact: true })).toBeVisible();
  await expect(page.getByText("Désactivé", { exact: true })).toBeVisible();
});

test("private dashboard redirects anonymous visitors to Better Auth", async ({ page }) => {
  await page.goto("/dashboard");
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
