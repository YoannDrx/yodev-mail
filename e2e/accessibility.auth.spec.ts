import AxeBuilder from "@axe-core/playwright";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { expect, test, type Page } from "@playwright/test";
import { authTestPool } from "../test/e2e/database";

// Self-contained on purpose: other workstreams own e2e/authenticated.spec.ts.
// Accounts are synthetic and the database guard limits writes to the local
// disposable database.
const pool = authTestPool();
const password = randomBytes(24).toString("hex");
type Account = { id: string; email: string };

async function account(role = "user"): Promise<Account> {
  const id = randomUUID();
  const email = `${id}@example.invalid`;
  await pool.query("INSERT INTO auth_users (id,name,email,email_verified,role) VALUES ($1,$2,$3,true,$4)", [id, "Accessibility User", email, role]);
  await pool.query("INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
  return { id, email };
}

async function workspace(owner: Account, status: "approved" | "sandbox") {
  const id = randomUUID();
  const orgId = randomUUID();
  const name = `Accessibility ${status} ${id.slice(0, 8)}`;
  await pool.query("INSERT INTO auth_organizations (id,name,slug) VALUES ($1,$2,$3)", [orgId, name, orgId]);
  await pool.query("INSERT INTO workspaces (id,auth_organization_id,auth_owner_user_id,name,slug,status,plan) VALUES ($1,$2,$3,$4,$5,$6,'starter')", [id, orgId, owner.id, name, id, status]);
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), orgId, owner.id]);
  const domainId = randomUUID();
  const profileId = randomUUID();
  const messageId = randomUUID();
  await pool.query("INSERT INTO domains (id,workspace_id,name) VALUES ($1,$2,$3)", [domainId, id, `${id}.example.invalid`]);
  await pool.query("INSERT INTO transactional_profiles (id,workspace_id,key,name,trigger_description,recipient_relationship,content_example) VALUES ($1,$2,'receipt','Receipt','Synthetic purchase','Synthetic customer','Synthetic receipt')", [profileId, id]);
  await pool.query("INSERT INTO messages (id,workspace_id,domain_id,transactional_profile_id,stream,send_mode,status,from_email,to_email,subject,html,plain_text) VALUES ($1,$2,$3,$4,'transactional','test','simulated','sender@example.invalid','recipient@example.invalid','Synthetic subject','<p>Synthetic</p>','Synthetic')", [messageId, id, domainId, profileId]);
  return { id, name, messageId };
}

async function signIn(page: Page, user: Account, baseURL: string) {
  const response = await page.request.post("/api/auth/sign-in/email", {
    data: { email: user.email, password },
    headers: { origin: baseURL },
  });
  expect(response.status()).toBe(200);
}

async function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to (execute|load|apply)/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  return violations;
}

async function auditPage(page: Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBeLessThan(400);
  expect(new URL(page.url()).pathname, `${url} must not redirect`).toBe(new URL(url, "http://x").pathname);
  await expect(page.locator('meta[name="robots"]'), url).toHaveAttribute("content", /noindex/);
  await expect(page.locator("#main-content"), url).toHaveCount(1);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  // Soft so that one run reports every page that needs fixing.
  expect.soft(result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), url).toEqual([]);
}

test.beforeEach(async ({ context, baseURL }) => {
  await pool.query("DELETE FROM auth_rate_limits");
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== baseURL) await route.abort("blockedbyclient");
    else await route.continue();
  });
});

test.afterAll(async () => { await pool.end(); });

for (const colorScheme of ["light", "dark"] as const) {
  test(`every console page passes axe WCAG A/AA in the ${colorScheme} theme, is noindex and CSP-clean`, async ({ page, baseURL }) => {
    test.setTimeout(600_000);
    const admin = await account("admin");
    const tenant = await workspace(admin, "approved");
    await page.emulateMedia({ colorScheme });
    const violations = await watchCsp(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await signIn(page, admin, baseURL!);
    for (const path of [
      "/dashboard",
      "/dashboard/emails",
      `/dashboard/emails/${tenant.messageId}`,
      "/dashboard/delivrabilite",
      "/dashboard/domaines",
      "/dashboard/profils",
      "/dashboard/templates",
      "/dashboard/api-keys",
      "/dashboard/webhooks",
      "/dashboard/membres",
      "/dashboard/facturation",
      "/dashboard/parametres",
      "/admin",
    ]) {
      await auditPage(page, `/fr${path}`);
      await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${colorScheme}\\b`));
    }
    await auditPage(page, "/en/dashboard");
    expect(violations).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test("onboarding pages pass axe WCAG A/AA in both themes", async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  const applicant = await account();
  await workspace(applicant, "sandbox");
  const violations = await watchCsp(page);
  await signIn(page, applicant, baseURL!);
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await auditPage(page, "/fr/onboarding");
  }
  await page.context().clearCookies();
  const orphan = await account();
  await signIn(page, orphan, baseURL!);
  await auditPage(page, "/fr/onboarding");
  expect(violations).toEqual([]);
});

test("the console skip link bypasses the sidebar", async ({ page, baseURL }) => {
  const owner = await account();
  await workspace(owner, "approved");
  await signIn(page, owner, baseURL!);
  await page.goto("/fr/dashboard");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Aller au contenu principal" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main-content")).toBeFocused();
});
