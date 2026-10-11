import "server-only";

import { and, asc, desc, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  apiKeys,
  attachments,
  auditEvents,
  authInvitations,
  authMembers,
  authUsers,
  domains,
  emailEvents,
  messages,
  subscriptions,
  suppressions,
  templates,
  templateVersions,
  transactionalProfiles,
  usageDays,
  usageMonths,
  webhookEndpoints,
  workspaceSettings,
  workspaces,
} from "@/db/schema";

export const workspaceExportFormat = "yodev-mail-workspace-export";
export const workspaceExportVersion = 1;
const pageSize = 1_000;

/**
 * Owner-initiated export of one workspace (GDPR access and portability).
 *
 * Every column is listed explicitly: secrets and their hashes (API keys,
 * webhook signing secrets), provider credentials and external identifiers,
 * Stripe identifiers, request hashes, IP addresses and raw provider payloads
 * are never part of an export. Message bodies are not exported either: they
 * are kept 30 days at most and only for delivery.
 *
 * Yields JSON text chunks so large histories stream with bounded memory.
 */
export async function* workspaceExportChunks(workspaceId: string, now = new Date()): AsyncGenerator<string> {
  z.uuid().parse(workspaceId);
  const db = requireDb();
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      slug: workspaces.slug,
      status: workspaces.status,
      plan: workspaces.plan,
      contentPolicy: workspaces.contentPolicy,
      websiteUrl: workspaces.websiteUrl,
      useCase: workspaces.useCase,
      expectedMonthlyVolume: workspaces.expectedMonthlyVolume,
      dailyLimit: workspaces.dailyLimit,
      warmupStage: workspaces.warmupStage,
      approvedAt: workspaces.approvedAt,
      pausedAt: workspaces.pausedAt,
      pauseReason: workspaces.pauseReason,
      createdAt: workspaces.createdAt,
      authOrganizationId: workspaces.authOrganizationId,
    })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) throw new Error("workspace_not_found");
  const { authOrganizationId, ...workspaceFields } = workspace;

  yield `{"format":${JSON.stringify(workspaceExportFormat)},"version":${workspaceExportVersion},"exportedAt":${JSON.stringify(now.toISOString())}`;
  yield `,"workspace":${JSON.stringify(workspaceFields)}`;

  const [settings] = await db
    .select({
      companyName: workspaceSettings.companyName,
      companyAddress: workspaceSettings.companyAddress,
      defaultFromName: workspaceSettings.defaultFromName,
      defaultReplyTo: workspaceSettings.defaultReplyTo,
      timezone: workspaceSettings.timezone,
      locale: workspaceSettings.locale,
      abusePolicyAcceptedAt: workspaceSettings.abusePolicyAcceptedAt,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  yield `,"settings":${JSON.stringify(settings ?? null)}`;

  const members = authOrganizationId
    ? await db
        .select({ name: authUsers.name, email: authUsers.email, role: authMembers.role, joinedAt: authMembers.createdAt })
        .from(authMembers)
        .innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
        .where(eq(authMembers.organizationId, authOrganizationId))
        .orderBy(asc(authMembers.createdAt))
    : [];
  yield `,"members":${JSON.stringify(members)}`;
  const invitations = authOrganizationId
    ? await db
        .select({ email: authInvitations.email, role: authInvitations.role, status: authInvitations.status, expiresAt: authInvitations.expiresAt, createdAt: authInvitations.createdAt })
        .from(authInvitations)
        .where(eq(authInvitations.organizationId, authOrganizationId))
        .orderBy(asc(authInvitations.createdAt))
    : [];
  yield `,"invitations":${JSON.stringify(invitations)}`;

  const [subscription] = await db
    .select({
      plan: subscriptions.plan,
      status: subscriptions.status,
      currentPeriodStartsAt: subscriptions.currentPeriodStartsAt,
      currentPeriodEndsAt: subscriptions.currentPeriodEndsAt,
      canceledAt: subscriptions.canceledAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  yield `,"subscription":${JSON.stringify(subscription ?? null)}`;

  yield `,"usageMonths":${JSON.stringify(
    await db
      .select({ month: usageMonths.month, acceptedEmails: usageMonths.acceptedEmails })
      .from(usageMonths)
      .where(eq(usageMonths.workspaceId, workspaceId))
      .orderBy(asc(usageMonths.month)),
  )}`;
  yield `,"usageDays":${JSON.stringify(
    await db
      .select({
        day: usageDays.day,
        acceptedEmails: usageDays.acceptedEmails,
        deliveredEmails: usageDays.deliveredEmails,
        hardBounces: usageDays.hardBounces,
        complaints: usageDays.complaints,
        suppressedEmails: usageDays.suppressedEmails,
        failedEmails: usageDays.failedEmails,
      })
      .from(usageDays)
      .where(eq(usageDays.workspaceId, workspaceId))
      .orderBy(asc(usageDays.day)),
  )}`;

  yield `,"domains":${JSON.stringify(
    await db
      .select({
        id: domains.id,
        name: domains.name,
        status: domains.status,
        mailFromDomain: domains.mailFromDomain,
        dkimStatus: domains.dkimStatus,
        mailFromStatus: domains.mailFromStatus,
        dmarcStatus: domains.dmarcStatus,
        dnsRecords: domains.dnsRecords,
        verifiedAt: domains.verifiedAt,
        createdAt: domains.createdAt,
      })
      .from(domains)
      .where(eq(domains.workspaceId, workspaceId))
      .orderBy(asc(domains.createdAt)),
  )}`;

  yield `,"transactionalProfiles":${JSON.stringify(
    await db
      .select({
        id: transactionalProfiles.id,
        key: transactionalProfiles.key,
        name: transactionalProfiles.name,
        triggerDescription: transactionalProfiles.triggerDescription,
        recipientRelationship: transactionalProfiles.recipientRelationship,
        expectedMonthlyVolume: transactionalProfiles.expectedMonthlyVolume,
        contentExample: transactionalProfiles.contentExample,
        status: transactionalProfiles.status,
        submittedAt: transactionalProfiles.submittedAt,
        approvedAt: transactionalProfiles.approvedAt,
        rejectionReason: transactionalProfiles.rejectionReason,
        createdAt: transactionalProfiles.createdAt,
      })
      .from(transactionalProfiles)
      .where(eq(transactionalProfiles.workspaceId, workspaceId))
      .orderBy(asc(transactionalProfiles.createdAt)),
  )}`;

  const templateRows = await db
    .select({
      id: templates.id,
      transactionalProfileId: templates.transactionalProfileId,
      name: templates.name,
      subject: templates.subject,
      preheader: templates.preheader,
      currentVersion: templates.currentVersion,
      reviewStatus: templates.reviewStatus,
      approvedAt: templates.approvedAt,
      rejectionReason: templates.rejectionReason,
      createdAt: templates.createdAt,
      updatedAt: templates.updatedAt,
    })
    .from(templates)
    .where(eq(templates.workspaceId, workspaceId))
    .orderBy(asc(templates.createdAt));
  yield `,"templates":[`;
  for (const [index, template] of templateRows.entries()) {
    const versions = await db
      .select({
        version: templateVersions.version,
        document: templateVersions.document,
        html: templateVersions.html,
        plainText: templateVersions.plainText,
        createdAt: templateVersions.createdAt,
      })
      .from(templateVersions)
      .where(and(eq(templateVersions.workspaceId, workspaceId), eq(templateVersions.templateId, template.id)))
      .orderBy(asc(templateVersions.version));
    yield `${index ? "," : ""}${JSON.stringify({ ...template, versions })}`;
  }
  yield "]";

  yield `,"apiKeys":${JSON.stringify(
    await db
      .select({
        name: apiKeys.name,
        mode: apiKeys.mode,
        prefix: apiKeys.prefix,
        scopes: apiKeys.scopes,
        lastUsedAt: apiKeys.lastUsedAt,
        revokedAt: apiKeys.revokedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.workspaceId, workspaceId))
      .orderBy(asc(apiKeys.createdAt)),
  )}`;
  yield `,"webhookEndpoints":${JSON.stringify(
    await db
      .select({ url: webhookEndpoints.url, eventTypes: webhookEndpoints.eventTypes, enabled: webhookEndpoints.enabled, createdAt: webhookEndpoints.createdAt })
      .from(webhookEndpoints)
      .where(eq(webhookEndpoints.workspaceId, workspaceId))
      .orderBy(asc(webhookEndpoints.createdAt)),
  )}`;

  // Suppressions older than 90 days only keep a hash, which is not exported.
  yield* paged(`,"suppressions":`, (cursor) =>
    db
      .select({
        cursorAt: cursorText(suppressions.createdAt),
        id: suppressions.id,
        email: suppressions.normalizedEmail,
        reason: suppressions.reason,
        provider: suppressions.provider,
        expiresAt: suppressions.expiresAt,
        createdAt: suppressions.createdAt,
      })
      .from(suppressions)
      .where(and(eq(suppressions.workspaceId, workspaceId), after(suppressions.createdAt, suppressions.id, cursor)))
      .orderBy(asc(suppressions.createdAt), asc(suppressions.id))
      .limit(pageSize),
  );

  yield* paged(`,"messages":`, (cursor) =>
    db
      .select({
        cursorAt: cursorText(messages.createdAt),
        id: messages.id,
        status: messages.status,
        stream: messages.stream,
        source: messages.source,
        sendMode: messages.sendMode,
        transactionalProfileId: messages.transactionalProfileId,
        domainId: messages.domainId,
        fromEmail: messages.fromEmail,
        fromName: messages.fromName,
        toEmail: messages.toEmail,
        toName: messages.toName,
        replyTo: messages.replyTo,
        subject: messages.subject,
        tags: messages.tags,
        lastError: messages.lastError,
        queuedAt: messages.queuedAt,
        acceptedAt: messages.acceptedAt,
        sentAt: messages.sentAt,
        deliveredAt: messages.deliveredAt,
        failedAt: messages.failedAt,
        lastEventAt: messages.lastEventAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), after(messages.createdAt, messages.id, cursor)))
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(pageSize),
  );

  yield* paged(`,"emailEvents":`, (cursor) =>
    db
      .select({ cursorAt: cursorText(emailEvents.createdAt), id: emailEvents.id, messageId: emailEvents.messageId, type: emailEvents.type, provider: emailEvents.provider, occurredAt: emailEvents.occurredAt, createdAt: emailEvents.createdAt })
      .from(emailEvents)
      .where(and(eq(emailEvents.workspaceId, workspaceId), after(emailEvents.createdAt, emailEvents.id, cursor)))
      .orderBy(asc(emailEvents.createdAt), asc(emailEvents.id))
      .limit(pageSize),
  );

  yield `,"attachments":${JSON.stringify(
    await db
      .select({
        id: attachments.id,
        messageId: attachments.messageId,
        fileName: attachments.fileName,
        contentType: attachments.declaredContentType,
        sizeBytes: attachments.sizeBytes,
        status: attachments.status,
        expiresAt: attachments.expiresAt,
        createdAt: attachments.createdAt,
      })
      .from(attachments)
      .where(eq(attachments.workspaceId, workspaceId))
      .orderBy(desc(attachments.createdAt))
      .limit(10_000),
  )}`;

  // Audit metadata can hold operator notes; actions and timestamps are kept.
  yield* paged(`,"auditEvents":`, (cursor) =>
    db
      .select({ cursorAt: cursorText(auditEvents.createdAt), id: auditEvents.id, action: auditEvents.action, entityType: auditEvents.entityType, entityId: auditEvents.entityId, actorUserId: auditEvents.actorUserId, createdAt: auditEvents.createdAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspaceId), after(auditEvents.createdAt, auditEvents.id, cursor)))
      .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id))
      .limit(pageSize),
  );

  yield "}\n";
}

type Cursor = { at: string; id: string } | null;

/** Exact text form of a timestamp: a JS Date would drop the microseconds. */
function cursorText(column: AnyColumn) {
  return sql<string>`(${column})::text`;
}

function after(createdAt: AnyColumn, id: AnyColumn, cursor: Cursor): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${createdAt}, ${id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

async function* paged<Row extends { cursorAt: string; id: string }>(
  prefix: string,
  load: (cursor: Cursor) => Promise<Row[]>,
): AsyncGenerator<string> {
  yield `${prefix}[`;
  let cursor: Cursor = null;
  let first = true;
  for (;;) {
    const rows = await load(cursor);
    for (const row of rows) {
      yield `${first ? "" : ","}${JSON.stringify({ ...row, cursorAt: undefined })}`;
      first = false;
    }
    if (rows.length < pageSize) break;
    const last = rows[rows.length - 1];
    cursor = { at: last.cursorAt, id: last.id };
  }
  yield "]";
}
