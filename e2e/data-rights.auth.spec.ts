import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { expect, test, type Page } from "@playwright/test";
import { authTestPool } from "../test/e2e/database";

// GDPR self-service: the owner exports then deletes the workspace, and a
// member deletes their own account, all from the console settings.
const pool = authTestPool();
const password = randomBytes(24).toString("hex");
type User = { id: string; email: string };

async function user(): Promise<User> {
  const id = randomUUID();
  const email = `${id}@example.invalid`;
  await pool.query("INSERT INTO auth_users (id,name,email,email_verified) VALUES ($1,$2,$3,true)", [id, "Data Rights User", email]);
  await pool.query("INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
  return { id, email };
}

async function tenant() {
  const id = randomUUID();
  const orgId = randomUUID();
  const owner = await user();
  const member = await user();
  const name = `Données ${id.slice(0, 8)}`;
  await pool.query("INSERT INTO auth_organizations (id,name,slug) VALUES ($1,$2,$3)", [orgId, name, orgId]);
  await pool.query("INSERT INTO workspaces (id,auth_organization_id,auth_owner_user_id,name,slug,status,plan) VALUES ($1,$2,$3,$4,$5,'approved','starter')", [id, orgId, owner.id, name, id]);
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), orgId, owner.id]);
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'member')", [randomUUID(), orgId, member.id]);
  await pool.query("INSERT INTO api_keys (workspace_id,name,mode,prefix,secret_hash,scopes,created_by) VALUES ($1,'Export check','test',$2,$3,ARRAY['emails:send'],$4)", [id, `ym_test_${id.slice(0, 8)}`, `hash-${randomUUID()}`, owner.id]);
  return { id, orgId, name, owner, member };
}

async function signIn(page: Page, account: User) {
  await page.goto("/fr/connexion");
  await page.getByLabel("Adresse email", { exact: true }).fill(account.email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  const response = page.waitForResponse((item) => item.url().endsWith("/api/auth/sign-in/email") && item.request().method() === "POST", { timeout: 60_000 });
  await page.getByRole("button", { name: "Se connecter par email" }).click();
  expect((await response).status()).toBe(200);
  await expect(page).not.toHaveURL(/\/connexion/, { timeout: 45_000 });
}

test.beforeEach(async ({ context, baseURL }) => {
  await pool.query("DELETE FROM auth_rate_limits");
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL!).origin) await route.abort("blockedbyclient");
    else await route.continue();
  });
});

test.afterAll(async () => { await pool.end(); });

test("the owner exports the workspace without secrets, then deletes it after typing its name", async ({ page }) => {
  const target = await tenant();
  await signIn(page, target.owner);
  await page.goto("/fr/dashboard/parametres");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger l’export" }).click();
  const exported = await readFile((await (await download).path())!, "utf8");
  expect(exported).toContain(target.name);
  expect(exported).toContain(target.member.email);
  const [{ secret_hash: secretHash }] = (await pool.query("SELECT secret_hash FROM api_keys WHERE workspace_id=$1", [target.id])).rows;
  expect(exported).not.toContain(secretHash);

  await page.getByRole("button", { name: "Supprimer le workspace" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel(`Saisissez « ${target.name} » pour confirmer`).fill("mauvais nom");
  await expect(dialog.getByRole("button", { name: "Supprimer définitivement" })).toBeDisabled();
  await dialog.getByLabel(`Saisissez « ${target.name} » pour confirmer`).fill(target.name);
  await dialog.getByRole("button", { name: "Supprimer définitivement" }).click();
  await expect(page).toHaveURL(/\/fr\/onboarding\?workspace=supprime/, { timeout: 45_000 });

  const [workspace] = (await pool.query("SELECT deleted_at FROM workspaces WHERE id=$1", [target.id])).rows;
  expect(workspace === undefined || workspace.deleted_at !== null).toBe(true);
  expect((await pool.query("SELECT 1 FROM api_keys WHERE workspace_id=$1 AND revoked_at IS NULL", [target.id])).rowCount).toBe(0);
  expect((await pool.query("SELECT 1 FROM auth_members WHERE organization_id=$1", [target.orgId])).rowCount).toBe(0);
});

test("a member deletes their own account and keeps the workspace intact", async ({ page }) => {
  const target = await tenant();
  await signIn(page, target.member);
  await page.goto("/fr/dashboard/parametres");
  await expect(page.getByText("Seul le propriétaire du workspace peut l’exporter ou le supprimer.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Télécharger l’export" })).toHaveCount(0);

  await page.getByRole("button", { name: "Supprimer mon compte" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("textbox").fill(target.member.email);
  await dialog.getByRole("button", { name: /Supprimer/ }).last().click();
  await expect(page).toHaveURL(/\/fr\?compte=supprime/, { timeout: 45_000 });

  expect((await pool.query("SELECT 1 FROM auth_users WHERE id=$1", [target.member.id])).rowCount).toBe(0);
  expect((await pool.query("SELECT deleted_at FROM workspaces WHERE id=$1", [target.id])).rows[0].deleted_at).toBeNull();
  expect((await pool.query("SELECT 1 FROM auth_members WHERE organization_id=$1 AND user_id=$2", [target.orgId, target.owner.id])).rowCount).toBe(1);
});
