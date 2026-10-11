import AxeBuilder from "@axe-core/playwright";
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
let origin = "";

async function user(address?: string): Promise<User> {
  const id = randomUUID();
  const email = address ?? `${id}@example.invalid`;
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

async function signIn(page: Page, account: User, expectedWorkspace?: Tenant, options: { alreadyOnPage?: boolean; landing?: RegExp } = {}) {
  if (!options.alreadyOnPage) await page.goto("/fr/connexion");
  await expect(page.getByRole("heading", { name: "Connexion à Yodev Mail" })).toBeVisible();
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
  else if (options.landing) await expect(page).toHaveURL(options.landing);
  else await expect(page).not.toHaveURL(/\/connexion/);
}

test.beforeEach(async ({ baseURL, context, page }) => {
  origin = new URL(baseURL!).origin;
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  // The guard in authTestPool limits this reset to the dedicated local database.
  // Keep production rate limiting enabled; each case starts with a fresh window.
  await pool.query("DELETE FROM auth_rate_limits");
  a = await tenant("A");
  b = await tenant("B");
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== origin) await route.abort("blockedbyclient");
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
  const switchResponse = await page.request.post("/api/auth/organization/set-active", { data: { organizationId: b.orgId }, headers: { origin } });
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
  // The wrong account is explained (without revealing the full invited address) and can switch.
  const mismatch = page.getByRole("alert").filter({ hasText: "Ce compte ne correspond pas à l’invitation" });
  await expect(mismatch).toContainText(b.owner.email);
  await expect(mismatch).not.toContainText(invitee.email);
  await expect(page.getByRole("button", { name: "Accepter l’invitation" })).toHaveCount(0);
  const forged = await page.request.post("/api/auth/organization/accept-invitation", { data: { invitationId }, headers: { origin } });
  expect(forged.ok()).toBe(false);
  expect((await pool.query("SELECT id FROM auth_members WHERE organization_id=$1 AND user_id=$2", [a.orgId, b.owner.id])).rowCount).toBe(0);
  await page.getByRole("button", { name: "Se déconnecter et changer de compte" }).click();
  await expect(page.getByRole("button", { name: "Continuer avec Google" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/fr/invitation\\?id=${invitationId}$`));
  await page.getByRole("link", { name: "Autre méthode de connexion" }).click();
  await expect(page).toHaveURL(/\/fr\/connexion\?next=/);
  await signIn(page, invitee, undefined, { alreadyOnPage: true });
  await expect(page).toHaveURL(new RegExp(`/fr/invitation\\?id=${invitationId}$`));
  await page.getByRole("button", { name: "Accepter l’invitation" }).click();
  await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
  const again = await page.request.post("/api/auth/organization/accept-invitation", { data: { invitationId }, headers: { origin } });
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


test("setup evidence and full navigation work in both themes at three sizes", async ({ page }, testInfo) => {
  await signIn(page, a.owner, a);
  await expect(page.getByRole("heading",{name:"Préparer les premiers envois"})).toBeVisible();
  await expect(page.getByText("Vérification DNS nécessaire",{exact:true})).toBeVisible();
  for (const width of [390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const theme of ["dark","light"]) {
      if (!(await page.locator("html").getAttribute("class"))?.includes(theme)) await page.getByRole("button",{name:"Changer le thème",exact:true}).click();
      await expect(page.locator("html")).toHaveClass(new RegExp(theme));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const results=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa"]).analyze();
      expect(results.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))).toEqual([]);
      await page.screenshot({path:testInfo.outputPath(`mail-${width}-${theme}.png`)});
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByLabel("Navigation complète",{exact:true}).click();
  await page.getByRole("navigation",{name:"Navigation principale",exact:true}).getByRole("link",{name:"Domaines",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Domaines",exact:true})).toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
});

test("OAuth failures land on a translated sign-in message, never on /?error=", async ({ page }) => {
  await page.goto("/fr/connexion");
  await page.goto("/api/auth/callback/google?error=access_denied&state=invalid");
  await expect(page).toHaveURL(/\/fr\/connexion\?error=state_mismatch$/);
  await expect(page.getByRole("alert").filter({ hasText: "Session de connexion expirée" })).toBeVisible();
  await page.goto("/api/auth/error?error=state_not_found");
  await expect(page).toHaveURL(/\/fr\/connexion\?error=state_not_found$/);
  await expect(page.getByRole("alert").filter({ hasText: "Session de connexion expirée" })).toBeVisible();

  await page.goto("/fr/connexion?error=INVITATION_REQUIRED");
  const invitation = page.getByRole("alert").filter({ hasText: "Invitation requise" });
  await expect(invitation).toBeVisible();
  await expect(invitation.getByRole("link", { name: "Déposer une candidature" })).toHaveAttribute("href", "/fr/inscription");
  for (const [query, title] of [
    ["erreur=oauth&error=access_denied", "Connexion annulée"],
    ["error=account_not_linked", "Compte non lié à Google"],
    ["erreur=oauth", "La connexion n’a pas abouti"],
    ["error=%3Cb%3Einjected%3C%2Fb%3E", "La connexion n’a pas abouti"],
  ]) {
    await page.goto(`/fr/connexion?${query}`);
    await expect(page.getByRole("alert").filter({ hasText: title })).toBeVisible();
  }
  await expect(page.getByText("injected")).toHaveCount(0);
  await page.goto("/en/connexion?error=INVITATION_REQUIRED");
  await expect(page.getByRole("alert").filter({ hasText: "Invitation required" })).toBeVisible();
  await expect(page).toHaveTitle(/^Sign in/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
});

test("the requested page survives sign-in and redirects stay on this origin", async ({ page }) => {
  const requested = `/fr/dashboard/emails/${a.messageId}`;
  await page.goto(requested);
  await expect(page).toHaveURL(/\/fr\/connexion\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(requested);
  await signIn(page, a.owner, undefined, { alreadyOnPage: true });
  await expect(page.getByRole("heading", { name: a.subject })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(requested);

  // Already signed in: /connexion forwards, and only to a same-origin path.
  for (const next of ["https://evil.example/phish", "//evil.example/phish", "/\\evil.example", "javascript:alert(1)"]) {
    await page.goto(`/fr/connexion?next=${encodeURIComponent(next)}`);
    await expect(page.getByRole("heading", { name: a.name, exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).toBe(origin);
    expect(new URL(page.url()).pathname).toBe("/fr/dashboard");
  }
  await page.goto(`/fr/connexion?next=${encodeURIComponent("/fr/dashboard/domaines")}`);
  await expect(page.getByRole("heading", { name: "Domaines", exact: true })).toBeVisible();
});

test("unused Better Auth endpoints are closed even with an owner session", async ({ page }) => {
  await signIn(page, a.owner, a);
  for (const [path, data] of [
    ["/api/auth/organization/invite-member", { email: "target@example.invalid", role: "member", organizationId: a.orgId }],
    ["/api/auth/organization/update", { data: { name: "Hijacked" }, organizationId: a.orgId }],
    ["/api/auth/organization/update-member-role", { memberId: randomUUID(), role: "owner", organizationId: a.orgId }],
    ["/api/auth/organization/get-full-organization", {}],
    ["/api/auth/admin/impersonate-user", { userId: b.owner.id }],
    ["/api/auth/sign-up/email", { email: "intruder@example.invalid", password: "a-long-enough-password", name: "Intruder" }],
  ] as const) {
    const response = await page.request.post(path, { data, headers: { origin } });
    expect(response.status(), path).toBe(404);
  }
  expect((await pool.query("SELECT id FROM auth_invitations WHERE organization_id=$1", [a.orgId])).rowCount).toBe(0);
  expect((await pool.query("SELECT name FROM auth_organizations WHERE id=$1", [a.orgId])).rows[0].name).toBe(a.name);
  expect((await pool.query("SELECT id FROM auth_users WHERE email='intruder@example.invalid'")).rowCount).toBe(0);
  // The organization endpoints used by the interface stay available.
  expect((await page.request.get("/api/auth/organization/list")).status()).toBe(200);
});

test("Administration is only offered to platform administrators", async ({ page }) => {
  await signIn(page, a.owner, a);
  await expect(page.getByRole("link", { name: "Administration", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/connexion/);
  const operator = await user();
  await member(a, operator);
  await pool.query("UPDATE auth_users SET role='admin' WHERE id=$1", [operator.id]);
  await signIn(page, operator, a);
  await page.getByRole("link", { name: "Administration", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Validation transactionnelle et fournisseurs" })).toBeVisible();
  await expect(page).toHaveTitle(/^Administration Yodev/);
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/connexion$/);
});

test("an ambiguous first administrator sign-in is explained instead of failing", async ({ page }) => {
  // AUTH_BOOTSTRAP_EMAIL in the Playwright server; several workspaces already exist.
  const bootstrapEmail = "unused-bootstrap@example.invalid";
  await pool.query("DELETE FROM auth_users WHERE email=$1", [bootstrapEmail]);
  const bootstrap = await user(bootstrapEmail);
  await signIn(page, bootstrap, undefined, { landing: /\/fr\/connexion\?erreur=bootstrap$/ });
  await expect(page.getByRole("alert").filter({ hasText: "Compte administrateur à rattacher" })).toBeVisible();
  expect((await pool.query("SELECT id FROM auth_members WHERE user_id=$1", [bootstrap.id])).rowCount).toBe(0);
  expect((await pool.query("SELECT role FROM auth_users WHERE id=$1", [bootstrap.id])).rows[0].role).not.toBe("admin");
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/connexion$/);
  expect((await pool.query("SELECT id FROM auth_sessions WHERE user_id=$1", [bootstrap.id])).rowCount).toBe(0);
});

test("with Postmark off, an admin creates a client and the copied link lets its owner join", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const operator = await user();
  await pool.query("UPDATE auth_users SET role='admin' WHERE id=$1", [operator.id]);
  await signIn(page, operator);
  await page.goto("/fr/admin");
  const slug = `client-${randomUUID().slice(0, 8)}`;
  const name = `Client ${slug}`;
  const ownerEmail = `owner-${randomUUID()}@example.invalid`;
  await page.getByLabel("Entreprise").fill(name);
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("Email du propriétaire").fill(ownerEmail);
  await page.getByLabel("Site web").fill("https://client.example.invalid");
  await page.getByLabel("Volume mensuel attendu").fill("1200");
  await page.getByLabel("Cas d’usage transactionnel").fill("Reçus de paiement envoyés après chaque commande validée.");
  await page.getByRole("button", { name: "Créer et inviter le propriétaire" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Client créé" })).toContainText("L’email d’invitation n’a pas pu être envoyé");
  const link = await page.getByLabel("Lien d’invitation").inputValue();
  expect(link).toMatch(new RegExp(`^${origin}/fr/invitation\\?id=[0-9a-f-]{36}$`));
  await page.getByRole("button", { name: "Copier le lien", exact: true }).click();
  await expect(page.getByRole("button", { name: "Lien copié", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  const invitationId = new URL(link).searchParams.get("id");
  const workspace = (await pool.query("SELECT id, auth_organization_id FROM workspaces WHERE slug=$1", [slug])).rows[0];
  const audit = await pool.query("SELECT metadata FROM audit_events WHERE workspace_id=$1 AND action='workspace.invitation_link_copied' AND entity_id=$2", [workspace.id, invitationId]);
  expect(audit.rowCount).toBe(1);
  expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(ownerEmail);
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/fr\/connexion$/);

  // The invited owner's account (Google in production, a local password here).
  const owner = await user(ownerEmail);
  await page.goto(link);
  await expect(page.getByText(`Vous êtes invité à rejoindre ${name}.`)).toBeVisible();
  await page.getByRole("link", { name: "Autre méthode de connexion" }).click();
  await signIn(page, owner, undefined, { alreadyOnPage: true });
  await expect(page).toHaveURL(new RegExp(`/fr/invitation\\?id=${invitationId}$`));
  await page.getByRole("button", { name: "Accepter l’invitation" }).click();
  await expect(page.getByRole("heading", { name: "Décrivez précisément votre flux transactionnel." })).toBeVisible();
  const membership = await pool.query("SELECT role FROM auth_members WHERE organization_id=$1 AND user_id=$2", [workspace.auth_organization_id, owner.id]);
  expect(membership.rows).toEqual([{ role: "owner" }]);
  expect((await pool.query("SELECT status FROM auth_invitations WHERE id=$1", [invitationId])).rows[0].status).toBe("accepted");
});

test("members page restricts plain members and confirms owner changes", async ({ page }) => {
  const reader = await user();
  await member(a, reader);
  await signIn(page, reader, a);
  await page.goto("/fr/dashboard/membres");
  await expect(page.getByText("Seuls le propriétaire et les administrateurs du workspace peuvent inviter ou retirer des membres.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inviter" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retirer" })).toHaveCount(0);
  await expect(page).toHaveTitle(/^Membres/);
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await expect(page).toHaveURL(/\/connexion/);

  await signIn(page, a.owner, a);
  await page.goto("/fr/dashboard/membres");
  const email = page.getByLabel("Email du membre");
  await email.fill("pas-une-adresse");
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Vérifiez l’adresse saisie." })).toBeVisible();
  await expect(page.getByText("Indiquez une adresse email valide.")).toBeVisible();
  await expect(email).toHaveValue("pas-une-adresse");

  const inviteeEmail = `${randomUUID()}@example.invalid`;
  await email.fill(inviteeEmail);
  await page.getByRole("button", { name: "Inviter", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "l’email n’a pas pu être envoyé" })).toBeVisible();
  await expect(page.getByLabel("Lien d’invitation")).toHaveValue(/\/fr\/invitation\?id=/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) }))).toEqual([]);
  // Owner, member and pending invitation fill the three seats.
  await expect(page.getByText("Toutes les places sont occupées")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inviter", exact: true })).toBeDisabled();

  const invitationRow = page.getByRole("article").filter({ hasText: inviteeEmail });
  await invitationRow.getByRole("button", { name: "Obtenir le lien" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Lien d’invitation prêt." })).toBeVisible();
  await invitationRow.getByRole("button", { name: "Révoquer" }).click();
  await expect(page.getByRole("alertdialog", { name: "Révoquer cette invitation ?" })).toBeVisible();
  await page.getByRole("alertdialog").getByRole("button", { name: "Révoquer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Invitation révoquée." })).toBeVisible();
  await expect(invitationRow).toHaveCount(0);
  expect((await pool.query("SELECT status FROM auth_invitations WHERE organization_id=$1 AND email=$2", [a.orgId, inviteeEmail])).rows[0].status).toBe("canceled");

  const readerRow = page.getByRole("article").filter({ hasText: reader.email });
  await readerRow.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Annuler" }).click();
  expect((await pool.query("SELECT id FROM auth_members WHERE organization_id=$1 AND user_id=$2", [a.orgId, reader.id])).rowCount).toBe(1);
  await readerRow.getByRole("button", { name: "Retirer" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Retirer" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Membre retiré du workspace." })).toBeVisible();
  expect((await pool.query("SELECT id FROM auth_members WHERE organization_id=$1 AND user_id=$2", [a.orgId, reader.id])).rowCount).toBe(0);

  await pool.query("UPDATE workspaces SET status='pending_review' WHERE id=$1", [a.id]);
  await page.reload();
  await expect(page.getByText("Les invitations s’ouvrent dès que Yodev a approuvé votre workspace.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Inviter", exact: true })).toBeDisabled();
});
