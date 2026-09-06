import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { expect, test, type Page } from "@playwright/test";
import { authTestPool } from "../test/e2e/database";

const pool = authTestPool();
const password = randomBytes(24).toString("hex");
type User = { id: string; email: string };
type Tenant = { id: string; orgId: string; name: string; owner: User; messageId: string; subject: string };
let a: Tenant;
let b: Tenant;
const browserErrors = new WeakMap<Page, string[]>();

async function user(): Promise<User> {
  const id = randomUUID();
  const email = `${id}@example.invalid`;
  await pool.query("INSERT INTO auth_users (id,name,email,email_verified) VALUES ($1,$2,$3,true)", [id, "Certification User", email]);
  await pool.query("INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
  return { id, email };
}

async function member(tenant: Tenant, account: User, role = "member") {
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,$4)", [randomUUID(), tenant.orgId, account.id, role]);
}

async function tenant(label: string): Promise<Tenant> {
  const id = randomUUID();
  const orgId = randomUUID();
  const owner = await user();
  const name = `Certification ${label} ${id.slice(0, 8)}`;
  await pool.query("INSERT INTO auth_organizations (id,name,slug) VALUES ($1,$2,$3)", [orgId, name, orgId]);
  await pool.query("INSERT INTO workspaces (id,auth_organization_id,auth_owner_user_id,name,slug,status,plan) VALUES ($1,$2,$3,$4,$5,'approved','starter')", [id, orgId, owner.id, name, id]);
  const domainId = randomUUID();
  const profileId = randomUUID();
  const messageId = randomUUID();
  const subject = `Private subject ${label} ${id}`;
  await pool.query("INSERT INTO domains (id,workspace_id,name) VALUES ($1,$2,$3)", [domainId, id, `${id}.example.invalid`]);
  await pool.query("INSERT INTO transactional_profiles (id,workspace_id,key,name,trigger_description,recipient_relationship,content_example) VALUES ($1,$2,'receipt','Receipt','Synthetic purchase','Synthetic customer','Synthetic receipt')", [profileId, id]);
  await pool.query("INSERT INTO messages (id,workspace_id,domain_id,transactional_profile_id,stream,send_mode,status,from_email,to_email,subject,html,plain_text) VALUES ($1,$2,$3,$4,'transactional','test','simulated','sender@example.invalid','recipient@example.invalid',$5,'<p>Synthetic</p>','Synthetic')", [messageId, id, domainId, profileId, subject]);
  const result = { id, orgId, name, owner, messageId, subject };
  await member(result, owner, "owner");
  return result;
}

async function signIn(page: Page, account: User, expectedWorkspace?: Tenant) {
  await page.goto("/fr/connexion");
  await expect(page.getByRole("heading", { name: "Connexion à Mail by Yodev" })).toBeVisible();
  await page.getByLabel("Adresse email", { exact: true }).fill(account.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  const response = page.waitForResponse((item) => item.url().endsWith("/api/auth/sign-in/email") && item.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Se connecter par email" }).click();
  expect((await response).status()).toBe(200);
  if (expectedWorkspace) {
    await expect(page.getByRole("heading", { name: expectedWorkspace.name, exact: true })).toBeVisible({ timeout: 45_000 });
    // The selector is populated by the real client-side organization request.
    // Waiting for it also avoids clicking server-rendered controls before hydration.
    await expect(page.getByLabel("Workspace actif")).toHaveValue(expectedWorkspace.orgId);
  }
  else await expect(page).not.toHaveURL(/\/connexion/);
}

test.beforeEach(async ({ context, page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // The guard in authTestPool limits this reset to the dedicated local database.
  // Keep production rate limiting enabled; each case starts with a fresh window.
  await pool.query("DELETE FROM auth_rate_limits");
  a = await tenant("A");
  b = await tenant("B");
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== "http://localhost:3918") await route.abort("blockedbyclient");
    else await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "No uncaught browser or server-rendering error").toEqual([]);
});

test.afterAll(async () => { await pool.end(); });

test("real password session, private pages and sign-out revocation", async ({ page }, testInfo) => {
  await signIn(page, a.owner, a);
  await page.screenshot({ path: testInfo.outputPath("workspace.png"), fullPage: true });
  const cookie = (await page.context().cookies()).find((item) => item.name.includes("session_token"));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  const sessions = await pool.query("SELECT id FROM auth_sessions WHERE user_id=$1", [a.owner.id]);
  expect(sessions.rowCount).toBe(1);
  await page.goto(`/fr/dashboard/emails/${a.messageId}`);
  await expect(page.getByRole("heading", { name: a.subject })).toBeVisible();
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/connexion/);
  expect((await pool.query("SELECT id FROM auth_sessions WHERE user_id=$1", [a.owner.id])).rowCount).toBe(0);
  await page.goto(`/fr/dashboard/emails/${a.messageId}`);
  await expect(page).toHaveURL(/\/fr\/connexion/);
  await expect(page.getByText(a.subject)).toHaveCount(0);
});

test("another tenant and the global admin console are inaccessible", async ({ page }) => {
  await signIn(page, a.owner, a);
  const switchResponse = await page.request.post("/api/auth/organization/set-active", { data: { organizationId: b.orgId }, headers: { origin: "http://localhost:3918" } });
  expect(switchResponse.ok()).toBe(false);
  await page.goto(`/fr/dashboard/emails/${b.messageId}`);
  await expect(page.getByText(b.subject)).toHaveCount(0);
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await page.goto("/fr/admin");
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await page.goto("/fr/dashboard");
  await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
});

test("authorized workspace switching changes the server data scope", async ({ page }) => {
  const dualMember = await user();
  await member(a, dualMember);
  await member(b, dualMember);
  await signIn(page, dualMember, a);
  await page.getByLabel("Workspace actif").selectOption(b.orgId);
  await expect(page.getByRole("heading", { name: b.name, exact: true })).toBeVisible();
  await page.goto(`/fr/dashboard/emails/${b.messageId}`);
  await expect(page.getByRole("heading", { name: b.subject })).toBeVisible();
  await page.goto(`/fr/dashboard/emails/${a.messageId}`);
  await expect(page.getByText(a.subject)).toHaveCount(0);
  await expect(page.getByText("404", { exact: true })).toBeVisible();
});

test("removing a membership invalidates workspace access for an existing session", async ({ page }) => {
  const reader = await user();
  await member(a, reader);
  await signIn(page, reader, a);
  await pool.query("DELETE FROM auth_members WHERE organization_id=$1 AND user_id=$2", [a.orgId, reader.id]);
  await page.goto(`/fr/dashboard/emails/${a.messageId}`);
  await expect(page).toHaveURL(/\/fr\/onboarding/);
  await expect(page.getByRole("heading", { name: "Aucun workspace accessible" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Se déconnecter", exact: true })).toBeVisible();
  await expect(page.getByText(a.subject)).toHaveCount(0);
  expect((await pool.query("SELECT id FROM auth_sessions WHERE user_id=$1", [reader.id])).rowCount).toBe(1);
});

test("API key creation, cross-tenant reads and immediate revocation", async ({ page }) => {
  await signIn(page, a.owner, a);
  await page.goto("/fr/dashboard/api-keys");
  await page.locator('input[name="name"]').fill("Certification key");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  const tokenElement = page.locator("code").filter({ hasText: /^ym_test_/ });
  await expect(tokenElement).toBeVisible();
  const token = (await tokenElement.textContent())!;
  const headers = { authorization: `Bearer ${token}` };
  const own = await page.request.get(`/v1/emails/${a.messageId}`, { headers });
  expect(own.status()).toBe(200);
  expect((await own.json()).data.id).toBe(a.messageId);
  expect((await page.request.get(`/v1/emails/${b.messageId}`, { headers })).status()).toBe(404);
  await page.reload();
  await expect(page.getByText(token, { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Révoquer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Révoquée", exact: true })).toBeDisabled();
  expect((await page.request.get(`/v1/emails/${a.messageId}`, { headers })).status()).toBe(401);
  expect((await pool.query("SELECT id FROM api_keys WHERE workspace_id=$1", [b.id])).rowCount).toBe(0);
});

test("member cannot create privileged API keys through a server action", async ({ page }) => {
  const reader = await user();
  await member(a, reader);
  await signIn(page, reader, a);
  await page.goto("/fr/dashboard/api-keys");
  await page.locator('input[name="name"]').fill("Forbidden key");
  await page.getByRole("button", { name: "Créer", exact: true }).click();
  await expect(page.getByText("Workspace administrator role required.", { exact: true })).toBeVisible();
  expect((await pool.query("SELECT id FROM api_keys WHERE workspace_id=$1", [a.id])).rowCount).toBe(0);
});

test("invitation is restricted to its recipient and accepted only once", async ({ page }) => {
  const invitee = await user();
  const invitationId = randomUUID();
  await pool.query("INSERT INTO auth_invitations (id,organization_id,email,role,expires_at,inviter_id) VALUES ($1,$2,$3,'member',now()+interval '1 hour',$4)", [invitationId, a.orgId, invitee.email, a.owner.id]);
  await signIn(page, b.owner, b);
  await page.goto(`/fr/invitation?id=${invitationId}`);
  await page.getByRole("button", { name: "Accepter l’invitation" }).click();
  await expect(page.getByText("Cette invitation est invalide, expirée ou destinée à une autre adresse.")).toBeVisible();
  await page.goto("/fr/dashboard");
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/connexion/);
  await signIn(page, invitee);
  await expect(page.getByRole("heading", { name: "Aucun workspace accessible" })).toBeVisible();
  await page.goto(`/fr/invitation?id=${invitationId}`);
  await page.getByRole("button", { name: "Accepter l’invitation" }).click();
  await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
  const again = await page.request.post("/api/auth/organization/accept-invitation", { data: { invitationId }, headers: { origin: "http://localhost:3918" } });
  expect(again.ok()).toBe(false);
  expect((await pool.query("SELECT id FROM auth_members WHERE organization_id=$1 AND user_id=$2", [a.orgId, invitee.id])).rowCount).toBe(1);
});

test("passkey registration and passwordless sign-in use real WebAuthn", async ({ page, context }) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  try {
    await signIn(page, a.owner, a);
    await page.getByRole("button", { name: "Ajouter une passkey", exact: true }).click();
    await expect(page.getByText("Passkey enregistrée.", { exact: true })).toBeAttached();
    expect((await pool.query("SELECT id FROM auth_passkeys WHERE user_id=$1", [a.owner.id])).rowCount).toBe(1);
    await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
    await expect(page).toHaveURL(/\/connexion/);
    await page.getByRole("button", { name: "Utiliser une passkey", exact: true }).click();
    await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
    expect((await pool.query("SELECT id FROM auth_sessions WHERE user_id=$1", [a.owner.id])).rowCount).toBe(1);
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.detach();
  }
});
