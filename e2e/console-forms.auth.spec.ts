import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { expect, test, type Page } from "@playwright/test";
import { authTestPool } from "../test/e2e/database";

// Console forms must refuse invalid input without leaving the page: the
// values stay, the error is announced (role="alert") and nothing is written.
const pool = authTestPool();
const password = randomBytes(24).toString("hex");
type User = { id: string; email: string };
type Tenant = { id: string; orgId: string; name: string; owner: User; domainId: string; domainName: string; profileId: string };
const browserErrors = new WeakMap<Page, string[]>();

async function user(): Promise<User> {
  const id = randomUUID();
  const email = `${id}@example.invalid`;
  await pool.query("INSERT INTO auth_users (id,name,email,email_verified) VALUES ($1,$2,$3,true)", [id, "Console User", email]);
  await pool.query("INSERT INTO auth_accounts (id,account_id,provider_id,user_id,password) VALUES ($1,$2,'credential',$2,$3)", [randomUUID(), id, await hashPassword(password)]);
  return { id, email };
}

async function tenant(status: "approved" | "sandbox" = "approved"): Promise<Tenant> {
  const id = randomUUID();
  const orgId = randomUUID();
  const owner = await user();
  const name = `Console ${id.slice(0, 8)}`;
  const domainId = randomUUID();
  const profileId = randomUUID();
  const domainName = `${id.slice(0, 8)}.example.invalid`;
  await pool.query("INSERT INTO auth_organizations (id,name,slug) VALUES ($1,$2,$3)", [orgId, name, orgId]);
  await pool.query("INSERT INTO workspaces (id,auth_organization_id,auth_owner_user_id,name,slug,status,plan) VALUES ($1,$2,$3,$4,$5,$6,'starter')", [id, orgId, owner.id, name, id, status]);
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), orgId, owner.id]);
  if (status === "approved") {
    await pool.query("INSERT INTO domains (id,workspace_id,name) VALUES ($1,$2,$3)", [domainId, id, domainName]);
    await pool.query("INSERT INTO transactional_profiles (id,workspace_id,key,name,trigger_description,recipient_relationship,content_example,status) VALUES ($1,$2,'receipt','Receipt','Synthetic purchase event','Synthetic customer account','Synthetic receipt content','approved')", [profileId, id]);
  }
  return { id, orgId, name, owner, domainId, domainName, profileId };
}

async function member(target: Tenant, role = "member") {
  const account = await user();
  await pool.query("INSERT INTO auth_members (id,organization_id,user_id,role) VALUES ($1,$2,$3,$4)", [randomUUID(), target.orgId, account.id, role]);
  return account;
}

/** Makes the sender domain ready, as Yodev's provisioning would. */
async function readyToSend(target: Tenant) {
  await pool.query("UPDATE domains SET status='verified', active_provider='postmark', dkim_status='verified' WHERE id=$1 AND workspace_id=$2", [target.domainId, target.id]);
  await pool.query("INSERT INTO domain_provider_bindings (workspace_id,domain_id,provider,status,dkim_status,return_path_status,is_active) VALUES ($1,$2,'postmark','verified','verified','verified',true)", [target.id, target.domainId]);
  await pool.query("INSERT INTO workspace_provider_accounts (workspace_id,provider,status) VALUES ($1,'postmark','ready')", [target.id]);
}

async function approvedTemplate(target: Tenant) {
  const templateId = randomUUID();
  await pool.query("INSERT INTO templates (id,workspace_id,transactional_profile_id,name,subject,review_status) VALUES ($1,$2,$3,'Reçu de paiement','Votre reçu {{orderId}}','approved')", [templateId, target.id, target.profileId]);
  await pool.query("INSERT INTO template_versions (workspace_id,template_id,version,document,html,plain_text,created_by) VALUES ($1,$2,1,$3,$4,$5,'seed')", [target.id, templateId, JSON.stringify({ version: 1, blocks: [] }), "<p>Bonjour {{firstName}}</p>", "Bonjour {{firstName}}"]);
  return templateId;
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

/** Skips the browser's own constraint checks so the server-side answer is exercised. */
async function submitWithoutBrowserValidation(page: Page, button: string) {
  const submit = page.getByRole("button", { name: button, exact: true });
  await submit.evaluate((element) => { (element as HTMLButtonElement).form!.noValidate = true; });
  await submit.click();
}

test.beforeEach(async ({ context, page, baseURL }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  await pool.query("DELETE FROM auth_rate_limits");
  await pool.query("DELETE FROM api_rate_limits");
  await context.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin !== new URL(baseURL!).origin) await route.abort("blockedbyclient");
    else await route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page), "No uncaught browser or server-rendering error").toEqual([]);
});

test.afterAll(async () => { await pool.end(); });

test("onboarding dossier keeps every answer when the server refuses it, then submits", async ({ page }) => {
  const target = await tenant("sandbox");
  await signIn(page, target.owner);
  await expect(page).toHaveURL(/\/fr\/onboarding/);
  await expect(page).toHaveTitle(/Dossier de bêta privée/);
  await expect(page.getByRole("button", { name: "Se déconnecter", exact: true })).toBeVisible();
  await expect(page.getByLabel("Événement déclencheur précis")).toHaveAttribute("minlength", "20");

  await page.getByLabel("Identité légale").fill("Certification SAS");
  await page.getByLabel("Application concernée").fill("Facturation");
  await page.getByLabel("Adresse professionnelle").fill("1 rue de la Paix, 75002 Paris");
  await page.getByLabel("Site public").fill("https://example.invalid");
  await page.getByLabel("Domaines ou sous-domaines d’envoi").fill("notifications.example.invalid");
  await page.getByLabel("Catégories transactionnelles").fill("Reçus de paiement");
  // Twenty characters for the browser, five once trimmed by the server.
  await page.getByLabel("Événement déclencheur précis").fill(`        court       `);
  await page.getByLabel("Relation avec les destinataires").fill("Clients ayant un compte actif");
  await page.getByLabel("Volume mensuel").fill("1000");
  await page.getByLabel("Moyenne quotidienne").fill("30");
  await page.getByLabel("Pic quotidien").fill("120");
  await page.getByLabel("Exemples de sujets et contenus").fill("Votre reçu n° 1234 est disponible dans votre espace.");
  await page.getByLabel("Gestion des erreurs et destinataires invalides").fill("Les rebonds suppriment l’adresse.");
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByRole("button", { name: "Envoyer pour validation" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "Certains champs sont invalides" })).toBeVisible();
  await expect(page).toHaveURL(/\/fr\/onboarding/);
  const trigger = page.getByLabel("Événement déclencheur précis");
  await expect(trigger).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("Entre 20 et 2 000 caractères.")).toBeVisible();
  await expect(page.getByLabel("Identité légale")).toHaveValue("Certification SAS");
  await expect(page.getByLabel("Exemples de sujets et contenus")).toHaveValue("Votre reçu n° 1234 est disponible dans votre espace.");
  await expect(page.getByLabel("Pic quotidien")).toHaveValue("120");
  for (const box of await page.getByRole("checkbox").all()) await expect(box).toBeChecked();
  expect((await pool.query("SELECT status FROM workspaces WHERE id=$1", [target.id])).rows[0].status).toBe("sandbox");

  await trigger.fill("Paiement confirmé par le prestataire bancaire");
  await page.getByRole("button", { name: "Envoyer pour validation" }).click();
  await expect(page).toHaveURL(/\/fr\/dashboard$/);
  expect((await pool.query("SELECT status FROM workspaces WHERE id=$1", [target.id])).rows[0].status).toBe("pending_review");
});

test("domains, use cases and API keys answer invalid input in place", async ({ page }) => {
  const target = await tenant();
  await signIn(page, target.owner);

  await page.goto("/fr/dashboard/domaines");
  await expect(page).toHaveTitle(/Domaines/);
  const recheck = page.getByRole("button", { name: "Revérifier" });
  await expect(recheck).toBeDisabled();
  await expect(page.getByText("Disponible dès que Yodev a préparé les enregistrements DNS.")).toBeVisible();
  await page.getByLabel("Domaine d’envoi").fill("https://exemple.invalid/chemin");
  await submitWithoutBrowserValidation(page, "Ajouter");
  await expect(page.getByRole("alert").filter({ hasText: "Saisissez un nom de domaine complet" })).toBeVisible();
  await expect(page.getByLabel("Domaine d’envoi")).toHaveValue("https://exemple.invalid/chemin");
  await expect(page.getByLabel("Domaine d’envoi")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Domaine d’envoi").fill(`second-${target.domainName}`);
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "a été ajouté" })).toBeVisible();
  await expect(page.getByRole("heading", { name: `second-${target.domainName}` })).toBeVisible();
  await page.getByLabel("Domaine d’envoi").fill("troisieme.example.invalid");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Limite atteinte" })).toBeVisible();
  await expect(page.getByLabel("Domaine d’envoi")).toHaveValue("troisieme.example.invalid");

  await page.goto("/fr/dashboard/profils");
  await page.getByLabel("Clé de catégorie (champ category de l’API)").fill("receipt");
  await page.getByLabel("Nom", { exact: true }).fill("Reçu en double");
  await page.getByLabel("Volume mensuel estimé").fill("500");
  await page.getByLabel("Événement déclencheur").fill("Paiement confirmé par la banque partenaire");
  await page.getByLabel("Relation avec le destinataire").fill("Client ayant passé la commande");
  await page.getByLabel("Exemple de contenu").fill("Votre reçu pour la commande 1234 est prêt.");
  await page.getByRole("button", { name: "Soumettre à validation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Un cas d’usage utilise déjà cette clé" })).toBeVisible();
  await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("Reçu en double");
  await page.getByLabel("Clé de catégorie (champ category de l’API)").fill("Clé Invalide");
  await submitWithoutBrowserValidation(page, "Soumettre à validation");
  await expect(page.getByRole("alert").filter({ hasText: "Certains champs sont invalides" })).toBeVisible();
  await expect(page.getByText("Minuscules, chiffres et _ uniquement")).toBeVisible();
  await expect(page.getByLabel("Exemple de contenu")).toHaveValue("Votre reçu pour la commande 1234 est prêt.");
  expect((await pool.query("SELECT id FROM transactional_profiles WHERE workspace_id=$1", [target.id])).rowCount).toBe(1);

  await page.goto("/fr/dashboard/api-keys");
  await expect(page.getByLabel("Nom de la clé")).toBeVisible();
  const mode = page.getByLabel("Mode", { exact: true });
  await expect(mode.locator('option[value="live"]')).toBeDisabled();
  await expect(page.getByText("Live indisponible : les envois live ne sont pas encore ouverts")).toBeVisible();
  await expect(page.getByRole("group", { name: "Permissions" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /attachments:write/ })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /emails:send — envoyer/ })).toBeChecked();
  await page.getByLabel("Nom de la clé").fill("x");
  await page.getByRole("checkbox", { name: /emails:read/ }).uncheck();
  await submitWithoutBrowserValidation(page, "Créer la clé");
  await expect(page.getByRole("alert").filter({ hasText: "Certains champs sont invalides" })).toBeVisible();
  await expect(page.getByText("Entre 2 et 120 caractères.")).toBeVisible();
  await expect(page.getByLabel("Nom de la clé")).toHaveValue("x");
  await expect(page.getByRole("checkbox", { name: /emails:read/ })).not.toBeChecked();
  // A forged live request is refused by the server too.
  await mode.evaluate((select) => {
    const option = (select as HTMLSelectElement).querySelector('option[value="live"]') as HTMLOptionElement;
    option.disabled = false;
    (select as HTMLSelectElement).value = "live";
  });
  await page.getByLabel("Nom de la clé").fill("Clé live forcée");
  await page.getByRole("button", { name: "Créer la clé", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Les envois live sont fermés" })).toBeVisible();
  expect((await pool.query("SELECT id FROM api_keys WHERE workspace_id=$1", [target.id])).rowCount).toBe(0);
});

test("templates show their ID, a test call that returns 202 simulated, and new versions", async ({ page, baseURL }) => {
  const target = await tenant();
  await readyToSend(target);
  const templateId = await approvedTemplate(target);
  await signIn(page, target.owner);

  await page.goto("/fr/dashboard/templates");
  await page.getByLabel("Nom", { exact: true }).fill("Bienvenue");
  await submitWithoutBrowserValidation(page, "Soumettre le template");
  await expect(page.getByRole("alert").filter({ hasText: "Certains champs sont invalides" })).toBeVisible();
  await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("Bienvenue");
  await expect(page.getByText("Choisissez le cas d’usage de ce template.")).toBeVisible();
  await expect(page.locator(`[data-template-id="${templateId}"]`)).toHaveText(templateId);
  await expect(page.getByRole("button", { name: "Copier l’ID" })).toBeVisible();

  await page.goto("/fr/dashboard/api-keys");
  await page.getByLabel("Nom de la clé").fill("Clé de test");
  await page.getByRole("button", { name: "Créer la clé", exact: true }).click();
  const token = (await page.locator("code").filter({ hasText: /^ym_test_/ }).textContent())!;

  await page.goto(`/fr/dashboard/templates/${templateId}`);
  await expect(page).toHaveTitle(/Template Reçu de paiement/);
  await expect(page.getByText("Toutes les conditions sont réunies pour un envoi de test.")).toBeVisible();
  const curl = (await page.getByTestId("template-curl").textContent())!;
  expect(curl).toContain("ym_test_VOTRE_CLE");
  expect(curl).toContain(templateId);
  expect(curl).toContain(`${baseURL}/v1/emails`);
  const output = execFileSync("bash", ["-c", `${curl.replace("ym_test_VOTRE_CLE", token)} -w '\\n%{http_code}'`]).toString().trim().split("\n");
  expect(output.at(-1)).toBe("202");
  expect(JSON.parse(output.slice(0, -1).join("\n")).data.status).toBe("simulated");

  await page.goto("/fr/dashboard");
  await expect(page.getByText("Envoi de test accepté", { exact: true })).toBeVisible();
  await expect(page.getByText("Clé ym_test_ active", { exact: true })).toBeVisible();

  await page.goto(`/fr/dashboard/templates/${templateId}`);
  const preview = page.locator("iframe").first();
  await expect(preview).toHaveAttribute("sandbox", "");
  await expect(page.frameLocator("iframe").first().getByText("Bonjour [firstName]")).toBeVisible();
  await page.getByLabel("Contenu texte").fill("Bonjour {{firstName}},\n\nVotre reçu <b>{{orderId}}</b> est prêt.");
  await expect(page.frameLocator("iframe").last().getByText("Votre reçu <b>[orderId]</b> est prêt.")).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer une nouvelle version" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Version 2 enregistrée" })).toBeVisible();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  expect((await pool.query("SELECT review_status, current_version FROM templates WHERE id=$1", [templateId])).rows[0]).toEqual({ review_status: "pending_review", current_version: 2 });
});

test("members see read-only controls and owners confirm key revocation", async ({ page }) => {
  const target = await tenant();
  const reader = await member(target);
  await pool.query("INSERT INTO api_keys (workspace_id,name,mode,prefix,secret_hash,scopes,created_by) VALUES ($1,'Existing','test','ym_test_abc',$2,ARRAY['emails:send'],'seed')", [target.id, randomBytes(32).toString("hex")]);
  await signIn(page, reader);
  await page.goto("/fr/dashboard/api-keys");
  await expect(page.getByText("Seuls les propriétaires et administrateurs peuvent créer une clé.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Créer la clé", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Révoquer", exact: true })).toBeDisabled();
  await page.goto("/fr/dashboard/templates");
  await expect(page.getByRole("button", { name: "Soumettre le template" })).toBeDisabled();
  await page.goto("/fr/dashboard/domaines");
  await expect(page.getByRole("button", { name: "Ajouter", exact: true })).toBeDisabled();

  await page.context().clearCookies();
  await signIn(page, target.owner);
  await page.goto("/fr/dashboard/api-keys");
  await page.getByRole("button", { name: "Révoquer", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Révoquer cette clé ?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Annuler" }).click();
  expect((await pool.query("SELECT revoked_at FROM api_keys WHERE workspace_id=$1", [target.id])).rows[0].revoked_at).toBeNull();
  await page.getByRole("button", { name: "Révoquer", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Révoquer la clé" }).click();
  await expect(page.getByRole("button", { name: "Révoquée", exact: true })).toBeDisabled();
});

test("emails are paginated, filtered and dated with their time zone", async ({ page }) => {
  const target = await tenant();
  await pool.query(`INSERT INTO messages (workspace_id,domain_id,transactional_profile_id,stream,send_mode,status,from_email,to_email,subject,html,plain_text,created_at)
    SELECT $1,$2,$3,'transactional','test',CASE WHEN n % 10 = 0 THEN 'delivered'::message_status ELSE 'simulated'::message_status END,'s@example.invalid','r@example.invalid','Sujet ' || n,'<p>x</p>','x',timestamptz '2026-10-01 12:00:00+00' - n * interval '1 minute'
    FROM generate_series(1,60) AS n`, [target.id, target.domainId, target.profileId]);
  await signIn(page, target.owner);
  await page.goto("/fr/dashboard/emails");
  await expect(page).toHaveTitle(/Emails envoyés/);
  await expect(page.getByRole("row")).toHaveCount(51);
  await expect(page.getByRole("cell", { name: /01\/10\/2026 13:59 UTC\+2/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "simulé", exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "Messages plus anciens" }).click();
  await expect(page.getByRole("row")).toHaveCount(11);
  await expect(page.getByRole("link", { name: "Messages plus anciens" })).toHaveCount(0);
  await page.getByLabel("Statut", { exact: true }).selectOption("delivered");
  await page.getByRole("button", { name: "Filtrer", exact: true }).click();
  await expect(page.getByRole("row")).toHaveCount(7);
  await page.getByLabel("Du", { exact: true }).fill("2026-10-02");
  await page.getByRole("button", { name: "Filtrer", exact: true }).click();
  await expect(page.getByText("Aucun message ne correspond à ces filtres.")).toBeVisible();

  await page.goto(`/fr/dashboard/emails/${randomUUID()}`);
  await expect(page.getByText("404", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ressource introuvable" })).toBeVisible();
  await page.getByRole("link", { name: "Retour à la vue d’ensemble" }).click();
  await expect(page.getByRole("heading", { name: target.name, exact: true })).toBeVisible();
});
