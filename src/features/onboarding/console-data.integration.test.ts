import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { databasePool, requireDb } from "@/db/runtime";
import {
  apiKeys,
  domainProviderBindings,
  domains,
  messages,
  templates,
  templateVersions,
  transactionalProfiles,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";
import { listWorkspaceEmails } from "@/app/dashboard/emails/list-query";
import { getActivationEvidence } from "@/features/onboarding/activation";
import { createTemplate, createTemplateVersion, TemplateNotEditableError } from "@/features/templates/versioning";

const db = requireDb();
const pool = databasePool!;

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  const names = result.rows.map(({ tablename }) => tablename).filter((name) => /^[a-z0-9_]+$/.test(name)).map((name) => `"${name}"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function seedWorkspace(status: "approved" | "pending_review" = "approved") {
  const id = randomUUID();
  await db.insert(workspaces).values({ id, name: `Workspace ${id.slice(0, 8)}`, slug: id, status, plan: "starter" });
  const domainId = randomUUID();
  await db.insert(domains).values({ id: domainId, workspaceId: id, name: `${id}.example.test`, status: "verified", activeProvider: "postmark" });
  const [profile] = await db.insert(transactionalProfiles).values({ workspaceId: id, key: "receipt", name: "Receipt", triggerDescription: "Paiement confirmé par la banque", recipientRelationship: "Clients avec un compte actif", contentExample: "Votre reçu est disponible.", status: "approved" }).returning();
  return { id, domainId, profileId: profile.id };
}

async function seedMessages(workspace: { id: string; domainId: string; profileId: string }, count: number, options: { createdAt?: Date; status?: "simulated" | "delivered" } = {}) {
  const rows = Array.from({ length: count }, (_, index) => ({
    workspaceId: workspace.id,
    domainId: workspace.domainId,
    transactionalProfileId: workspace.profileId,
    stream: "transactional" as const,
    sendMode: "test" as const,
    status: options.status ?? ("simulated" as const),
    fromEmail: "sender@example.test",
    toEmail: `recipient-${index}@example.test`,
    subject: `Subject ${index}`,
    html: "<p>x</p>",
    plainText: "x",
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
  }));
  await db.insert(messages).values(rows);
}

beforeEach(cleanDatabase);
afterAll(async () => { await pool.end(); });

describe("template versions", () => {
  it("stores each edit as a new version and sends the template back to review", async () => {
    const workspace = await seedWorkspace();
    const userId = randomUUID();
    const template = await createTemplate(db, { workspaceId: workspace.id, userId, transactionalProfileId: workspace.profileId, name: "Reçu", subject: "Reçu {{orderId}}", body: "Bonjour {{firstName}}" });
    await db.update(templates).set({ reviewStatus: "approved", approvedAt: new Date() }).where(eq(templates.id, template.id));

    expect(await createTemplateVersion(db, { workspaceId: workspace.id, userId, templateId: template.id, name: "Reçu v2", subject: "Votre reçu", body: "<b>Merci</b> {{firstName}}" })).toEqual({ version: 2 });

    const [updated] = await db.select().from(templates).where(eq(templates.id, template.id));
    expect(updated).toMatchObject({ currentVersion: 2, reviewStatus: "pending_review", approvedAt: null, name: "Reçu v2", subject: "Votre reçu" });
    const versions = await db.select().from(templateVersions).where(eq(templateVersions.templateId, template.id)).orderBy(templateVersions.version);
    expect(versions.map((version) => version.version)).toEqual([1, 2]);
    expect(versions[0].plainText).toBe("Bonjour {{firstName}}");
    expect(versions[1].html).toContain("&lt;b&gt;Merci&lt;/b&gt;");
  });

  it("never edits another workspace's template or a template disabled by Yodev", async () => {
    const owner = await seedWorkspace();
    const other = await seedWorkspace();
    const template = await createTemplate(db, { workspaceId: owner.id, userId: "u", transactionalProfileId: owner.profileId, name: "Reçu", subject: "Reçu", body: "Bonjour" });
    await expect(createTemplateVersion(db, { workspaceId: other.id, userId: "u", templateId: template.id, name: "x", subject: "x", body: "x" })).rejects.toBeInstanceOf(TemplateNotEditableError);
    await expect(createTemplate(db, { workspaceId: other.id, userId: "u", transactionalProfileId: owner.profileId, name: "x", subject: "x", body: "x" })).rejects.toMatchObject({ reason: "profile_not_found" });
    await db.update(templates).set({ reviewStatus: "disabled" }).where(eq(templates.id, template.id));
    await expect(createTemplateVersion(db, { workspaceId: owner.id, userId: "u", templateId: template.id, name: "x", subject: "x", body: "x" })).rejects.toMatchObject({ reason: "disabled" });
    expect(await db.select().from(templateVersions).where(eq(templateVersions.templateId, template.id))).toHaveLength(1);
  });
});

describe("activation evidence", () => {
  it("follows the workspace's own data from first test key to live key", async () => {
    const workspace = await seedWorkspace("pending_review");
    const other = await seedWorkspace();
    await db.insert(apiKeys).values({ workspaceId: other.id, name: "other", mode: "live", prefix: "ym_live_x", secretHash: randomUUID().replaceAll("-", "").padEnd(64, "0"), scopes: ["emails:send"], createdBy: "u" });

    const initial = await getActivationEvidence(db, workspace.id);
    expect(initial).toMatchObject({ domainVerified: false, profileApproved: true, testKey: false, templateApproved: false, simulatedSend: false, webhook: false, workspaceStatus: "pending_review", billingStatus: "inactive", liveKey: false });

    await db.insert(domainProviderBindings).values({ workspaceId: workspace.id, domainId: workspace.domainId, provider: "postmark", status: "verified", isActive: true });
    await db.insert(apiKeys).values({ workspaceId: workspace.id, name: "test", mode: "test", prefix: "ym_test_x", secretHash: randomUUID().replaceAll("-", "").padEnd(64, "1"), scopes: ["emails:send"], createdBy: "u" });
    const template = await createTemplate(db, { workspaceId: workspace.id, userId: "u", transactionalProfileId: workspace.profileId, name: "Reçu", subject: "Reçu", body: "Bonjour" });
    await db.update(templates).set({ reviewStatus: "approved" }).where(and(eq(templates.id, template.id), eq(templates.workspaceId, workspace.id)));
    await seedMessages(workspace, 1);
    await db.insert(webhookEndpoints).values({ workspaceId: workspace.id, url: "https://hooks.example.test", signingSecretHash: "h", signingSecretEncrypted: "e", eventTypes: ["email.delivered"] });

    expect(await getActivationEvidence(db, workspace.id)).toMatchObject({ domainVerified: true, testKey: true, templateApproved: true, simulatedSend: true, webhook: true, liveKey: false });
  });
});

describe("email list", () => {
  it("pages through more than 250 messages without gaps or duplicates", async () => {
    const workspace = await seedWorkspace();
    const other = await seedWorkspace();
    // Many rows share the same timestamp: the cursor must break ties by id.
    const instant = new Date("2026-10-01T10:00:00.123Z");
    await seedMessages(workspace, 180, { createdAt: instant });
    await seedMessages(workspace, 140);
    await seedMessages(other, 5);
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listWorkspaceEmails(db, workspace.id, { cursor }, "Europe/Paris", 50);
      for (const row of page.rows) {
        expect(seen.has(row.id)).toBe(false);
        seen.add(row.id);
      }
      cursor = page.nextCursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 20);
    expect(seen.size).toBe(320);
    expect(pages).toBe(7);
  });

  it("does not skip rows that share a millisecond but differ in microseconds", async () => {
    const workspace = await seedWorkspace();
    await seedMessages(workspace, 3);
    await pool.query("update messages set created_at = timestamptz '2026-10-01 10:00:00.123456+00' - (row_number_offset * interval '1 microsecond') from (select id as rid, row_number() over (order by id) as row_number_offset from messages) ranked where messages.id = ranked.rid");
    const first = await listWorkspaceEmails(db, workspace.id, {}, "UTC", 1);
    const second = await listWorkspaceEmails(db, workspace.id, { cursor: first.nextCursor! }, "UTC", 1);
    const third = await listWorkspaceEmails(db, workspace.id, { cursor: second.nextCursor! }, "UTC", 1);
    expect(new Set([...first.rows, ...second.rows, ...third.rows].map((row) => row.id)).size).toBe(3);
    expect(third.nextCursor).toBeNull();
  });

  it("filters by status and by calendar day in the workspace time zone", async () => {
    const workspace = await seedWorkspace();
    // 23:30 UTC on 30 Sept is 1 Oct in Paris.
    await seedMessages(workspace, 2, { createdAt: new Date("2026-09-30T23:30:00Z"), status: "delivered" });
    await seedMessages(workspace, 3, { createdAt: new Date("2026-09-30T12:00:00Z") });
    const paris = await listWorkspaceEmails(db, workspace.id, { from: "2026-10-01", to: "2026-10-01" }, "Europe/Paris");
    expect(paris.rows).toHaveLength(2);
    const utc = await listWorkspaceEmails(db, workspace.id, { from: "2026-10-01", to: "2026-10-01" }, "UTC");
    expect(utc.rows).toHaveLength(0);
    const delivered = await listWorkspaceEmails(db, workspace.id, { status: "delivered" }, "UTC");
    expect(delivered.rows.map((row) => row.status)).toEqual(["delivered", "delivered"]);
  });
});
