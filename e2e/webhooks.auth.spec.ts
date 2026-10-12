import AxeBuilder from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { expect, test, type Page } from "@playwright/test";
import { authTestPool } from "../test/e2e/database";

// Customer webhook console with real Better Auth sessions. The auth suite
// runs with CUSTOMER_WEBHOOKS_ENABLED=false, which is what is certified here:
// the console must say delivery is off, and every control stays usable.
const pool = authTestPool();
const password = randomBytes(24).toString("hex");
type Tenant = { id: string; orgId: string; name: string; ownerEmail: string };
const browserErrors = new WeakMap<Page, string[]>();

async function user() {
  const id = randomUUID();
  const email = `${id}@example.invalid`;
  await pool.query("INSERT INTO auth_users (id,name,email,email_verified) VALUES ($1,$2,$3,true)", [id, "Webhook Certification", email]);
  await pool.query("INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
  return { id, email };
}

async function tenant(): Promise<Tenant> {
  const id = randomUUID();
  const orgId = randomUUID();
  const owner = await user();
  const name = `Webhooks ${id.slice(0, 8)}`;
  await pool.query("INSERT INTO auth_organizations (id,name,slug) VALUES ($1,$2,$3)", [orgId, name, orgId]);
  await pool.query("INSERT INTO workspaces (id,auth_organization_id,auth_owner_user_id,name,slug,status,plan) VALUES ($1,$2,$3,$4,$5,'approved','starter')", [id, orgId, owner.id, name, id]);
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), orgId, owner.id]);
  return { id, orgId, name, ownerEmail: owner.email };
}

async function seedEndpoint(workspaceId: string, url: string) {
  const id = randomUUID();
  // Opaque placeholders: these tests never decrypt nor sign with them.
  await pool.query(
    "INSERT INTO webhook_endpoints (id,workspace_id,url,signing_secret_hash,signing_secret_encrypted,event_types) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, workspaceId, url, "0".repeat(64), "v2.placeholder.placeholder.placeholder", ["email.delivered"]],
  );
  return id;
}

async function signIn(page: Page, email: string, workspace: Tenant) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse email", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  const response = page.waitForResponse((item) => item.url().endsWith("/api/auth/sign-in/email") && item.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Se connecter par email" }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole("heading", { name: workspace.name, exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByLabel("Workspace actif")).toHaveValue(workspace.orgId);
}

async function openWebhooks(page: Page) {
  await page.goto("/fr/dashboard/webhooks");
  await expect(page.getByRole("heading", { name: "Webhooks", level: 1 })).toBeVisible();
  // Wait for hydration before using client controls.
  await expect(page.getByLabel("Workspace actif")).not.toHaveValue("");
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await pool.query("DELETE FROM auth_rate_limits");
  const origin = new URL(baseURL!).origin;
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) await route.abort("blockedbyclient");
    else await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "No uncaught browser or server-rendering error").toEqual([]);
});

test.afterAll(async () => { await pool.end(); });

test("webhook console states that delivery is off and keeps invalid input", async ({ page }) => {
  const workspace = await tenant();
  await seedEndpoint(workspace.id, "https://hooks.example.com/yodev");
  await signIn(page, workspace.ownerEmail, workspace);
  await openWebhooks(page);
  await expect(page).toHaveTitle(/^Webhooks du workspace/);
  await expect(page.getByRole("heading", { name: "Livraison désactivée pour l’instant" })).toBeVisible();
  const card = page.getByRole("article").filter({ hasText: "https://hooks.example.com/yodev" });
  await expect(card.getByText("Livraison désactivée", { exact: true })).toBeVisible();
  await expect(card.getByText("Actif", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Envoyer un événement de test" })).toBeDisabled();

  const url = page.getByLabel("URL de l’endpoint");
  await url.fill("pas-une-url");
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.uncheck();
  await page.getByRole("checkbox", { name: "email.hard_bounced" }).check();
  await page.getByRole("button", { name: "Ajouter l’endpoint" }).click();
  await expect(page.getByText("Saisissez une URL HTTPS complète.")).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Vérifiez les champs signalés." })).toBeVisible();
  await expect(url).toHaveValue("pas-une-url");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("checkbox", { name: "email.hard_bounced" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "email.delivered" })).not.toBeChecked();
  expect((await pool.query("SELECT id FROM webhook_endpoints WHERE workspace_id=$1", [workspace.id])).rowCount).toBe(1);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) }))).toEqual([]);
});

test("disabling and deleting an endpoint require confirmation", async ({ page }) => {
  const workspace = await tenant();
  const endpointId = await seedEndpoint(workspace.id, "https://hooks.example.com/confirm");
  await signIn(page, workspace.ownerEmail, workspace);
  await openWebhooks(page);
  const card = page.getByRole("article").filter({ hasText: "https://hooks.example.com/confirm" });

  await card.getByRole("button", { name: "Désactiver" }).click();
  const disableDialog = page.getByRole("alertdialog", { name: "Désactiver cet endpoint ?" });
  await disableDialog.getByRole("button", { name: "Annuler" }).click();
  expect((await pool.query("SELECT enabled FROM webhook_endpoints WHERE id=$1", [endpointId])).rows[0].enabled).toBe(true);

  await card.getByRole("button", { name: "Désactiver" }).click();
  await disableDialog.getByRole("button", { name: "Désactiver" }).click();
  await expect(card.getByText("Désactivé", { exact: true })).toBeVisible();
  expect((await pool.query("SELECT enabled FROM webhook_endpoints WHERE id=$1", [endpointId])).rows[0].enabled).toBe(false);

  await card.getByRole("button", { name: "Activer" }).click();
  await expect(card.getByText("Livraison désactivée", { exact: true })).toBeVisible();

  await card.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("alertdialog", { name: "Supprimer cet endpoint ?" }).getByRole("button", { name: "Supprimer" }).click();
  await expect(page.getByText("https://hooks.example.com/confirm")).toHaveCount(0);
  expect((await pool.query("SELECT id FROM webhook_endpoints WHERE id=$1", [endpointId])).rowCount).toBe(0);
});

test("a member cannot delete an endpoint through the server action", async ({ page }) => {
  const workspace = await tenant();
  const endpointId = await seedEndpoint(workspace.id, "https://hooks.example.com/member");
  const reader = await user();
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'member')", [randomUUID(), workspace.orgId, reader.id]);
  await signIn(page, reader.email, workspace);
  await openWebhooks(page);
  const card = page.getByRole("article").filter({ hasText: "https://hooks.example.com/member" });
  await card.getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("alertdialog", { name: "Supprimer cet endpoint ?" }).getByRole("button", { name: "Supprimer" }).click();
  await expect(card.getByRole("alert").filter({ hasText: "Seuls les propriétaires et administrateurs" })).toBeVisible();
  expect((await pool.query("SELECT id FROM webhook_endpoints WHERE id=$1", [endpointId])).rowCount).toBe(1);
});

test("a created endpoint shows its secret once and rotation replaces it", async ({ page }) => {
  const workspace = await tenant();
  await signIn(page, workspace.ownerEmail, workspace);
  await openWebhooks(page);
  // A public IP literal needs no DNS from the test machine.
  await page.getByLabel("URL de l’endpoint").fill("https://93.184.215.14/yodev-mail");
  await page.getByRole("button", { name: "Ajouter l’endpoint" }).click();
  const status = page.getByRole("status").or(page.getByRole("alert")).filter({ hasText: /Endpoint créé|chiffrement des webhooks/ }).first();
  await expect(status).toBeVisible();
  test.skip((await status.textContent())!.includes("chiffrement"), "WEBHOOK_SIGNING_SECRET is not configured for this test server.");

  const created = page.locator("code").filter({ hasText: /^whsec_ym_/ });
  await expect(created).toBeVisible();
  const firstSecret = await created.textContent();
  await expect(page.getByRole("button", { name: "Copier le secret" })).toBeVisible();
  await page.reload();
  await expect(page.getByText(firstSecret!, { exact: true })).toHaveCount(0);

  const card = page.getByRole("article").filter({ hasText: "https://93.184.215.14/yodev-mail" });
  await card.getByRole("button", { name: "Renouveler le secret" }).click();
  await page.getByRole("alertdialog", { name: "Renouveler le secret de signature ?" }).getByRole("button", { name: "Renouveler le secret" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const rotated = card.locator("code").filter({ hasText: /^whsec_ym_/ });
  await expect(rotated).toBeVisible();
  expect(await rotated.textContent()).not.toBe(firstSecret);
  expect((await pool.query("SELECT action FROM audit_events WHERE workspace_id=$1 ORDER BY created_at", [workspace.id])).rows.map((row) => row.action))
    .toEqual(["webhook.created", "webhook.secret_rotated"]);
});
