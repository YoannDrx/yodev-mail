import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  current: null as null | { workspace: { id: string; name: string; slug: string }; userId: string; orgId: string; role: string },
  deletedCookies: [] as string[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`); } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    getAll: () => [{ name: "yodev_mail.session_token", value: "x" }, { name: "yodev_mail_locale", value: "fr" }],
    delete: (name: string) => context.deletedCookies.push(name),
  }),
}));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/current-workspace", () => ({
  currentWorkspace: vi.fn(async () => {
    if (!context.current) throw new Error("Authentication is required.");
    return context.current;
  }),
}));
vi.mock("@/lib/operational-metric", () => ({ emitOperationalMetric: vi.fn() }));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: async () => {} }));

import { databasePool, requireDb } from "@/db/runtime";
import {
  apiKeys,
  auditEvents,
  authInvitations,
  authMembers,
  authOrganizations,
  authSessions,
  authUsers,
  domains,
  emailEvents,
  idempotencyKeys,
  messages,
  sesResources,
  stripeUsageReportJobs,
  subscriptions,
  suppressions,
  templates,
  templateVersions,
  transactionalProfiles,
  usageDays,
  usageLedger,
  webhookEndpoints,
  workspaceProviderAccounts,
  workspaceSettings,
  workspaces,
} from "@/db/schema";
import { GET as exportRoute } from "@/app/dashboard/parametres/export/route";
import { deleteAccountAction, deleteWorkspaceAction } from "@/features/workspace-data/actions";
import { deleteUserAccount, requestWorkspaceDeletion } from "@/features/workspace-data/deletion";
import { workspaceExportChunks } from "@/features/workspace-data/export";
import { purgeDeletedWorkspace } from "@/features/workspace-data/purge";
import { initialActionState } from "@/lib/action-state";
import { handler as retentionHandler } from "@/workers/purge-retention";

const db = requireDb();
const users: string[] = [];
const organizations: string[] = [];
const workspaceIds: string[] = [];

const secrets = {
  apiKeyHashPrefix: "a".repeat(32),
  webhookHash: "b".repeat(64),
  webhookEncrypted: "encrypted-webhook-secret-value",
  credentialParameter: "/yodev/prod/postmark/server-token-fixture",
  externalAccount: "postmark-server-987654",
  stripeCustomer: "cus_fixtureCustomer",
  sesTenant: "tenant-fixture-ses",
  requestHash: "c".repeat(64),
  sessionToken: "session-token-fixture",
  body: "<p>Private message body</p>",
};

async function user(role = "user") {
  const id = randomUUID();
  users.push(id);
  await db.insert(authUsers).values({ id, name: `User ${id.slice(0, 4)}`, email: `${id}@example.test`, emailVerified: true, role });
  return id;
}

async function seedWorkspace(options: { ownerId: string; memberId?: string; messageCount?: number; name?: string }) {
  const orgId = randomUUID();
  organizations.push(orgId);
  await db.insert(authOrganizations).values({ id: orgId, name: options.name ?? "Atelier", slug: orgId });
  await db.insert(authMembers).values({ id: randomUUID(), organizationId: orgId, userId: options.ownerId, role: "owner" });
  if (options.memberId) await db.insert(authMembers).values({ id: randomUUID(), organizationId: orgId, userId: options.memberId, role: "member" });
  await db.insert(authInvitations).values({ id: randomUUID(), organizationId: orgId, email: "invitee@example.test", role: "member", expiresAt: new Date(Date.now() + 864e5), inviterId: options.ownerId });
  await db.insert(authSessions).values({ id: randomUUID(), token: `${secrets.sessionToken}-${orgId}`, userId: options.ownerId, expiresAt: new Date(Date.now() + 864e5), activeOrganizationId: orgId, ipAddress: "203.0.113.9" });

  const id = randomUUID();
  workspaceIds.push(id);
  const name = options.name ?? "Atelier";
  await db.insert(workspaces).values({ id, name, slug: id, status: "approved", authOrganizationId: orgId, authOwnerUserId: options.ownerId, sesTenantName: secrets.sesTenant });
  await db.insert(workspaceSettings).values({ workspaceId: id, companyName: "Atelier SAS", defaultReplyTo: "support@atelier.example.test" });
  const [domain] = await db.insert(domains).values({ workspaceId: id, name: `${id.slice(0, 8)}.atelier.example.test`, status: "verified", sesIdentityArn: "arn:aws:ses:eu-west-3:123456789012:identity/fixture" }).returning();
  const [profile] = await db.insert(transactionalProfiles).values({ workspaceId: id, key: "receipt", name: "Reçus", triggerDescription: "Paiement", recipientRelationship: "Client", contentExample: "Votre reçu", status: "approved" }).returning();
  const [template] = await db.insert(templates).values({ workspaceId: id, transactionalProfileId: profile.id, name: "Reçu", subject: "Votre reçu" }).returning();
  await db.insert(templateVersions).values({ workspaceId: id, templateId: template.id, version: 1, document: { version: 1, blocks: [] }, html: "<p>Template</p>", plainText: "Template", createdBy: options.ownerId });
  await db.insert(apiKeys).values({ workspaceId: id, name: "Production", mode: "live", prefix: "ym_live_abcd", secretHash: `${secrets.apiKeyHashPrefix}${id.replaceAll("-", "")}`, createdBy: options.ownerId });
  await db.insert(webhookEndpoints).values({ workspaceId: id, url: "https://atelier.example.test/hooks", signingSecretHash: secrets.webhookHash, signingSecretEncrypted: secrets.webhookEncrypted });
  await db.insert(workspaceProviderAccounts).values({ workspaceId: id, provider: "postmark", status: "ready", externalAccountId: secrets.externalAccount, credentialParameterName: secrets.credentialParameter });
  await db.insert(sesResources).values({ workspaceId: id, domainId: domain.id, resourceType: "identity", resourceName: domain.name });
  await db.insert(subscriptions).values({ workspaceId: id, stripeCustomerId: `${secrets.stripeCustomer}_${id.slice(0, 6)}`, plan: "beta", status: "canceled" });
  await db.insert(usageDays).values({ workspaceId: id, day: "2026-10-01", acceptedEmails: 3 });
  await db.insert(suppressions).values({ workspaceId: id, normalizedEmail: "bounced@example.test", emailHash: "d".repeat(64), reason: "hard_bounce" });
  await db.insert(idempotencyKeys).values({ workspaceId: id, key: "idem-1", requestHash: secrets.requestHash, response: { ids: [] } });
  const createdAt = new Date("2026-10-01T10:00:00.123456Z");
  const rows = await db.insert(messages).values(Array.from({ length: options.messageCount ?? 3 }, () => ({
    workspaceId: id, domainId: domain.id, transactionalProfileId: profile.id, stream: "transactional" as const, status: "delivered" as const,
    fromEmail: "receipts@atelier.example.test", toEmail: "client@example.test", subject: "Votre reçu", html: secrets.body, plainText: "Private message body",
    requestHash: secrets.requestHash, createdAt,
  }))).returning({ id: messages.id });
  await db.insert(usageLedger).values({ workspaceId: id, messageId: rows[0].id, acceptedAt: createdAt });
  await db.insert(emailEvents).values({ workspaceId: id, messageId: rows[0].id, externalEventId: `evt-${id}`, type: "email.delivered", occurredAt: createdAt, payload: { raw: "provider payload" } });
  return { id, orgId, name, domain, messageIds: rows.map((row) => row.id) };
}

async function exportJson(workspaceId: string) {
  let text = "";
  for await (const chunk of workspaceExportChunks(workspaceId)) text += chunk;
  return { text, json: JSON.parse(text) };
}

afterEach(async () => {
  context.current = null;
  context.deletedCookies = [];
  if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds.splice(0)));
  if (organizations.length) await db.delete(authOrganizations).where(inArray(authOrganizations.id, organizations.splice(0)));
  if (users.length) {
    const ids = users.splice(0);
    await db.delete(auditEvents).where(inArray(auditEvents.actorUserId, ids));
    await db.delete(authUsers).where(inArray(authUsers.id, ids));
  }
});
afterAll(async () => { await databasePool!.end(); });

describe("workspace export", () => {
  it("exports one workspace without secrets, hashes, provider identifiers, bodies or other tenants", async () => {
    const owner = await user();
    const member = await user();
    const target = await seedWorkspace({ ownerId: owner, memberId: member, messageCount: 2_105 });
    const other = await seedWorkspace({ ownerId: await user(), name: "Other" });
    const { text, json } = await exportJson(target.id);

    expect(json).toMatchObject({ format: "yodev-mail-workspace-export", version: 1, workspace: { id: target.id, name: "Atelier" }, settings: { companyName: "Atelier SAS" }, subscription: { status: "canceled" } });
    expect(json.members.map((row: { role: string }) => row.role).sort()).toEqual(["member", "owner"]);
    expect(json.invitations).toHaveLength(1);
    expect(json.domains[0].name).toBe(target.domain.name);
    expect(json.templates[0].versions[0].html).toBe("<p>Template</p>");
    expect(json.apiKeys[0]).toEqual(expect.objectContaining({ prefix: "ym_live_abcd", mode: "live" }));
    expect(json.suppressions[0]).toMatchObject({ email: "bounced@example.test", reason: "hard_bounce" });
    // Keyset pagination over identical timestamps: every message exactly once.
    expect(new Set(json.messages.map((row: { id: string }) => row.id)).size).toBe(2_105);
    expect(json.messages).toHaveLength(2_105);
    expect(json.emailEvents).toHaveLength(1);
    expect(json.emailEvents[0]).not.toHaveProperty("payload");

    for (const forbidden of [secrets.apiKeyHashPrefix, secrets.webhookHash, secrets.webhookEncrypted, secrets.credentialParameter, secrets.externalAccount,
      secrets.stripeCustomer, secrets.sesTenant, secrets.requestHash, secrets.sessionToken, secrets.body, "provider payload", "203.0.113.9",
      "arn:aws:ses", other.id, other.domain.name, "secretHash", "signingSecret", "authOrganizationId"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("streams the export to the owner only and audits it", async () => {
    const owner = await user();
    const member = await user();
    const target = await seedWorkspace({ ownerId: owner, memberId: member });
    const workspace = { id: target.id, name: target.name, slug: "atelier" };

    expect((await exportRoute()).status).toBe(403);
    context.current = { workspace, userId: member, orgId: target.orgId, role: "member" };
    expect((await exportRoute()).status).toBe(403);
    context.current = { workspace, userId: owner, orgId: target.orgId, role: "owner" };
    const response = await exportRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="yodev-mail-atelier-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(await response.text()).workspace.id).toBe(target.id);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, target.id))).toEqual([
      expect.objectContaining({ action: "workspace.exported", actorUserId: owner }),
    ]);
  });
});

describe("workspace deletion", () => {
  it("refuses non-owners, a wrong name, a running subscription, queued messages and unreported usage", async () => {
    const owner = await user();
    const member = await user();
    const target = await seedWorkspace({ ownerId: owner, memberId: member });
    const request = (actorUserId: string, confirmationName = "Atelier") =>
      requestWorkspaceDeletion({ workspaceId: target.id, organizationId: target.orgId, actorUserId, confirmationName });

    expect(await request(member)).toEqual({ status: "refused", reason: "not_owner" });
    expect(await request(owner, "atelier")).toEqual({ status: "refused", reason: "confirmation_mismatch" });
    expect(await requestWorkspaceDeletion({ workspaceId: target.id, organizationId: randomUUID(), actorUserId: owner, confirmationName: "Atelier" }))
      .toEqual({ status: "refused", reason: "not_found" });

    await db.update(subscriptions).set({ status: "active" }).where(eq(subscriptions.workspaceId, target.id));
    expect(await request(owner)).toEqual({ status: "refused", reason: "subscription_active" });
    await db.update(subscriptions).set({ status: "canceled" }).where(eq(subscriptions.workspaceId, target.id));

    await db.update(messages).set({ status: "queued" }).where(eq(messages.id, target.messageIds[0]));
    expect(await request(owner)).toEqual({ status: "refused", reason: "messages_in_flight" });
    await db.update(messages).set({ status: "delivered" }).where(eq(messages.id, target.messageIds[0]));

    await db.insert(stripeUsageReportJobs).values({ workspaceId: target.id, messageId: target.messageIds[0], acceptedAt: new Date(), stripeIdentifier: `ym-${target.messageIds[0]}`, stripeCustomerId: "cus_x", stripeSubscriptionId: "sub_x" });
    expect(await request(owner)).toEqual({ status: "refused", reason: "usage_unreported" });

    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, target.id));
    expect(row).toMatchObject({ deletedAt: null, purgeRequestedAt: null, authOrganizationId: target.orgId });
    expect((await db.select().from(apiKeys).where(eq(apiKeys.workspaceId, target.id)))[0].revokedAt).toBeNull();
  });

  it("revokes access, purges only this workspace and keeps a provider cleanup trail", async () => {
    const owner = await user();
    const member = await user();
    const target = await seedWorkspace({ ownerId: owner, memberId: member, messageCount: 50 });
    const otherOwner = await user();
    const other = await seedWorkspace({ ownerId: otherOwner, name: "Other" });
    await db.insert(authMembers).values({ id: randomUUID(), organizationId: other.orgId, userId: member, role: "member" });

    expect(await requestWorkspaceDeletion({ workspaceId: target.id, organizationId: target.orgId, actorUserId: owner, confirmationName: " Atelier " }))
      .toEqual({ status: "deleted", purged: true });

    expect(await db.select().from(workspaces).where(eq(workspaces.id, target.id))).toHaveLength(0);
    for (const table of [messages, apiKeys, webhookEndpoints, domains, suppressions, usageLedger, emailEvents, workspaceProviderAccounts]) {
      expect(await db.select().from(table).where(eq(table.workspaceId, target.id))).toHaveLength(0);
    }
    expect(await db.select().from(authOrganizations).where(eq(authOrganizations.id, target.orgId))).toHaveLength(0);
    expect(await db.select().from(authMembers).where(eq(authMembers.organizationId, target.orgId))).toHaveLength(0);
    expect(await db.select().from(authInvitations).where(eq(authInvitations.organizationId, target.orgId))).toHaveLength(0);
    const [session] = await db.select().from(authSessions).where(eq(authSessions.userId, owner));
    expect(session.activeOrganizationId).toBeNull();
    // Users survive; the member keeps their other workspace.
    expect(await db.select().from(authUsers).where(inArray(authUsers.id, [owner, member]))).toHaveLength(2);
    expect(await db.select().from(authMembers).where(eq(authMembers.userId, member))).toHaveLength(1);

    expect(await db.select().from(messages).where(eq(messages.workspaceId, other.id))).toHaveLength(3);
    expect((await db.select().from(apiKeys).where(eq(apiKeys.workspaceId, other.id)))[0].revokedAt).toBeNull();

    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.entityId, target.id));
    expect(audit).toMatchObject({ workspaceId: null, action: "workspace.deleted", actorUserId: owner });
    expect(audit.metadata).toMatchObject({ providerCleanup: {
      sesTenantName: secrets.sesTenant,
      providerAccounts: [{ provider: "postmark", externalAccountId: secrets.externalAccount, credentialParameterName: secrets.credentialParameter }],
      domains: [target.domain.name],
    } });
    expect(JSON.stringify(audit.metadata)).not.toContain(secrets.apiKeyHashPrefix);
  });

  it("purges a marked workspace in bounded passes, finished by the retention worker, and never a live one", async () => {
    const live = await seedWorkspace({ ownerId: await user(), messageCount: 20 });
    expect(await purgeDeletedWorkspace(live.id, { batchSize: 5 })).toEqual({ done: true });
    expect(await db.select().from(messages).where(eq(messages.workspaceId, live.id))).toHaveLength(20);

    const marked = await seedWorkspace({ ownerId: await user(), messageCount: 30, name: "Marked" });
    await db.update(workspaces).set({ deletedAt: new Date(), purgeRequestedAt: new Date() }).where(eq(workspaces.id, marked.id));
    expect(await purgeDeletedWorkspace(marked.id, { budgetMs: 0 })).toEqual({ done: false });
    expect(await db.select().from(messages).where(eq(messages.workspaceId, marked.id))).toHaveLength(30);

    await retentionHandler();
    expect(await db.select().from(workspaces).where(eq(workspaces.id, marked.id))).toHaveLength(0);
    expect(await db.select().from(workspaces).where(eq(workspaces.id, live.id))).toHaveLength(1);
  });

  it("deletes the workspace and the owner account from the settings action", async () => {
    const owner = await user();
    const target = await seedWorkspace({ ownerId: owner });
    context.current = { workspace: { id: target.id, name: target.name, slug: "atelier" }, userId: owner, orgId: target.orgId, role: "owner" };

    const mismatch = new FormData();
    mismatch.set("confirmationName", "Wrong");
    expect(await deleteWorkspaceAction(initialActionState(), mismatch)).toMatchObject({ ok: false, fieldErrors: { confirmationName: [expect.any(String)] } });

    const data = new FormData();
    data.set("confirmationName", "Atelier");
    data.set("deleteAccount", "on");
    await expect(deleteWorkspaceAction(initialActionState(), data)).rejects.toThrow("REDIRECT:/fr?compte=supprime");
    expect(await db.select().from(workspaces).where(eq(workspaces.id, target.id))).toHaveLength(0);
    expect(await db.select().from(authUsers).where(eq(authUsers.id, owner))).toHaveLength(0);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, owner))).toHaveLength(0);
    expect(context.deletedCookies).toEqual(["yodev_mail.session_token"]);
  });

  it("refuses the settings action to an administrator who is not the owner", async () => {
    const owner = await user();
    const admin = await user();
    const target = await seedWorkspace({ ownerId: owner });
    context.current = { workspace: { id: target.id, name: target.name, slug: "atelier" }, userId: admin, orgId: target.orgId, role: "admin" };
    const data = new FormData();
    data.set("confirmationName", "Atelier");
    expect(await deleteWorkspaceAction(initialActionState(), data)).toMatchObject({ ok: false });
    expect(await db.select().from(workspaces).where(eq(workspaces.id, target.id))).toHaveLength(1);
  });
});

describe("account deletion", () => {
  it("refuses owners, platform admins and a wrong email, then deletes a member account", async () => {
    const owner = await user();
    const member = await user();
    const platformAdmin = await user("admin");
    const target = await seedWorkspace({ ownerId: owner, memberId: member });
    await db.insert(authInvitations).values({ id: randomUUID(), organizationId: target.orgId, email: "next@example.test", role: "member", expiresAt: new Date(Date.now() + 864e5), inviterId: member });
    await db.insert(authSessions).values({ id: randomUUID(), token: `member-${member}`, userId: member, expiresAt: new Date(Date.now() + 864e5), activeOrganizationId: target.orgId });

    expect(await deleteUserAccount({ userId: owner, confirmationEmail: `${owner}@example.test` })).toEqual({ status: "refused", reason: "owns_workspace" });
    expect(await deleteUserAccount({ userId: platformAdmin, confirmationEmail: `${platformAdmin}@example.test` })).toEqual({ status: "refused", reason: "platform_admin" });
    expect(await deleteUserAccount({ userId: member, confirmationEmail: "someone@example.test" })).toEqual({ status: "refused", reason: "confirmation_mismatch" });

    context.current = { workspace: { id: target.id, name: target.name, slug: "atelier" }, userId: member, orgId: target.orgId, role: "member" };
    const data = new FormData();
    data.set("confirmationEmail", `  ${member.toUpperCase()}@EXAMPLE.TEST `);
    await expect(deleteAccountAction(initialActionState(), data)).rejects.toThrow("REDIRECT:/fr?compte=supprime");

    expect(await db.select().from(authUsers).where(eq(authUsers.id, member))).toHaveLength(0);
    expect(await db.select().from(authSessions).where(eq(authSessions.userId, member))).toHaveLength(0);
    expect(await db.select().from(authMembers).where(eq(authMembers.userId, member))).toHaveLength(0);
    const [invitation] = await db.select().from(authInvitations).where(eq(authInvitations.email, "next@example.test"));
    expect(invitation.inviterId).toBeNull();
    expect(await db.select().from(workspaces).where(eq(workspaces.id, target.id))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.entityId, member))).toEqual([
      expect.objectContaining({ action: "account.deleted", workspaceId: null, metadata: {} }),
    ]);
  });
});
