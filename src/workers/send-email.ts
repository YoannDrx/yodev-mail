import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { and, eq, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  attachments,
  emailEvents,
  messageAttempts,
  messages,
  outboxJobs,
  usageDays,
  usageLedger,
  usageMonths,
  webhookDeliveries,
  webhookEndpoints,
  workspaceProviderAccounts,
} from "@/db/schema";
import { deliveryProvider } from "@/features/providers/registry";
import { ProviderSendError } from "@/features/providers/types";
import { evaluateStoredMessage, utcDay } from "@/features/sending/eligibility";
import { queuePublicEmailEvent } from "@/features/webhooks/public-email-event";
import { awsClients } from "@/lib/aws";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await sendOne(JSON.parse(record.body).messageId);
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

async function releaseReservation(workspaceId: string, reservedAt: Date) {
  await requireDb()
    .update(usageDays)
    .set({
      reservedEmails: sql`greatest(${usageDays.reservedEmails} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(and(eq(usageDays.workspaceId, workspaceId), eq(usageDays.day, utcDay(reservedAt))));
}

async function recordAttempt(input: {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark";
  status: string;
  outcome: "accepted" | "definitive_failure" | "transient_failure" | "ambiguous";
  errorCode?: string;
}) {
  const db = requireDb();
  const [latest] = await db.select({ value: sql<number>`coalesce(max(${messageAttempts.attempt}), 0)::int` })
    .from(messageAttempts).where(and(
      eq(messageAttempts.messageId, input.messageId),
      eq(messageAttempts.workspaceId, input.workspaceId),
    ));
  await db.insert(messageAttempts).values({ ...input, attempt: (latest?.value ?? 0) + 1 });
}

async function loadAttachments(messageId: string, workspaceId: string) {
  const rows = await requireDb().select().from(attachments).where(and(
    eq(attachments.messageId, messageId),
    eq(attachments.workspaceId, workspaceId),
    eq(attachments.status, "clean"),
  ));
  if (!rows.length) return { payloads: [], rows };
  const bucket = process.env.ATTACHMENTS_BUCKET_NAME;
  if (!bucket) throw new ProviderSendError("Attachment storage is not configured.", "definitive", "attachment_storage_unavailable");
  const { s3 } = await awsClients();
  const payloads = await Promise.all(rows.map(async (attachment) => {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: attachment.storageKey }));
    const content = await result.Body?.transformToByteArray();
    if (!content) throw new ProviderSendError("Attachment content is unavailable.", "definitive", "attachment_unavailable");
    return { name: attachment.fileName, contentType: attachment.detectedContentType ?? attachment.declaredContentType, content };
  }));
  return { payloads, rows };
}

async function purgeAttachments(rows: Array<typeof attachments.$inferSelect>) {
  if (!rows.length || !process.env.ATTACHMENTS_BUCKET_NAME) return;
  const { s3 } = await awsClients();
  for (const attachment of rows) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.ATTACHMENTS_BUCKET_NAME, Key: attachment.storageKey }));
    await requireDb().update(attachments).set({ status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(attachments.id, attachment.id),
      eq(attachments.workspaceId, attachment.workspaceId),
    ));
  }
}

async function publishTerminalEvent(input: {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark" | null;
  status: "failed" | "suppressed";
  errorCode: string;
}) {
  await queuePublicEmailEvent({
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    provider: input.provider,
    type: input.status === "suppressed" ? "email.suppressed" : "email.failed",
    errorCode: input.errorCode,
  });
}

export async function sendOne(messageId: string) {
  const db = requireDb();
  const [claimed] = await db
    .update(messages)
    .set({ status: "sending", sendingClaimedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(messages.id, messageId), eq(messages.status, "queued")))
    .returning();
  if (!claimed) return;
  if (!claimed.provider || !claimed.transactionalProfileId) {
    await db.update(messages).set({ status: "failed", lastError: "Provider assignment is missing.", updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
    await releaseReservation(claimed.workspaceId, claimed.queuedAt);
    await publishTerminalEvent({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: "failed", errorCode: "provider_assignment_missing" });
    return;
  }
  if (claimed.sendDeadlineAt && claimed.sendDeadlineAt <= new Date()) {
    await db.update(messages).set({ status: "failed", lastError: "send_deadline_exceeded", updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
    await releaseReservation(claimed.workspaceId, claimed.queuedAt);
    await publishTerminalEvent({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: "failed", errorCode: "send_deadline_exceeded" });
    return;
  }

  const eligibility = await evaluateStoredMessage(db, {
    domainId: claimed.domainId,
    mode: claimed.sendMode,
    profileId: claimed.transactionalProfileId,
    provider: claimed.provider,
    toEmail: claimed.toEmail,
    workspaceId: claimed.workspaceId,
  });
  if (!eligibility.allowed) {
    const status = eligibility.code === "recipient_suppressed" ? "suppressed" : "failed";
    await db.update(messages).set({ status, lastError: eligibility.reason, updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
    await releaseReservation(claimed.workspaceId, claimed.queuedAt);
    await publishTerminalEvent({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status, errorCode: eligibility.code });
    return;
  }

  const [account] = await db.select().from(workspaceProviderAccounts).where(and(
    eq(workspaceProviderAccounts.workspaceId, claimed.workspaceId),
    eq(workspaceProviderAccounts.provider, claimed.provider),
    eq(workspaceProviderAccounts.status, "ready"),
  )).limit(1);
  if (!account?.externalAccountId) {
    await db.update(messages).set({ status: "failed", lastError: "Provider account is unavailable.", updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
    await releaseReservation(claimed.workspaceId, claimed.queuedAt);
    await publishTerminalEvent({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: "failed", errorCode: "provider_account_unavailable" });
    return;
  }

  try {
    const loaded = await loadAttachments(claimed.id, claimed.workspaceId);
    const result = await deliveryProvider(claimed.provider).send({
      messageId: claimed.id,
      workspaceId: claimed.workspaceId,
      externalAccountId: account.externalAccountId,
      credentialParameterName: account.credentialParameterName,
      from: { email: claimed.fromEmail, name: claimed.fromName },
      to: { email: claimed.toEmail, name: claimed.toName },
      replyTo: claimed.replyTo,
      subject: claimed.subject,
      html: claimed.html,
      text: claimed.plainText,
      attachments: loaded.payloads,
    });
    const acceptedAt = result.acceptedAt;
    const month = acceptedAt.toISOString().slice(0, 7);
    await db.transaction(async (tx) => {
      await tx.update(messages).set({
        status: "sent",
        providerMessageId: result.providerMessageId,
        acceptedAt,
        providerAcceptedAt: acceptedAt,
        sentAt: acceptedAt,
        lastError: null,
        updatedAt: acceptedAt,
      }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId), eq(messages.status, "sending")));
      const ledger = await tx.insert(usageLedger).values({ acceptedAt, messageId: claimed.id, workspaceId: claimed.workspaceId }).onConflictDoNothing().returning();
      if (ledger.length) {
        await tx.update(usageDays).set({
          reservedEmails: sql`greatest(${usageDays.reservedEmails} - 1, 0)`,
          updatedAt: acceptedAt,
        }).where(and(eq(usageDays.workspaceId, claimed.workspaceId), eq(usageDays.day, utcDay(claimed.queuedAt))));
        await tx.insert(usageDays).values({ workspaceId: claimed.workspaceId, day: utcDay(acceptedAt), acceptedEmails: 1 }).onConflictDoUpdate({
          target: [usageDays.workspaceId, usageDays.day],
          set: { acceptedEmails: sql`${usageDays.acceptedEmails} + 1`, updatedAt: acceptedAt },
        });
        await tx.insert(usageMonths).values({ workspaceId: claimed.workspaceId, month, acceptedEmails: 1 }).onConflictDoUpdate({
          target: [usageMonths.workspaceId, usageMonths.month],
          set: { acceptedEmails: sql`${usageMonths.acceptedEmails} + 1`, updatedAt: acceptedAt },
        });
      }
      const [sentEvent] = await tx.insert(emailEvents).values({
        workspaceId: claimed.workspaceId,
        messageId: claimed.id,
        provider: claimed.provider,
        externalEventId: `yodev:sent:${claimed.id}`,
        type: "email.sent",
        occurredAt: acceptedAt,
        payload: {},
      }).onConflictDoNothing().returning();
      if (sentEvent) {
        const endpoints = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId, claimed.workspaceId), eq(webhookEndpoints.enabled, true)));
        for (const endpoint of endpoints) {
          if (!endpoint.eventTypes.includes("email.sent")) continue;
          const [delivery] = await tx.insert(webhookDeliveries).values({ workspaceId: claimed.workspaceId, endpointId: endpoint.id, eventId: sentEvent.id, nextAttemptAt: acceptedAt }).onConflictDoNothing().returning();
          if (delivery) await tx.insert(outboxJobs).values({ workspaceId: claimed.workspaceId, aggregateId: delivery.id, kind: "webhook" });
        }
      }
    });
    await recordAttempt({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: "accepted", outcome: "accepted" });
    try { await purgeAttachments(loaded.rows); } catch { /* lifecycle remains the final deletion guarantee */ }
  } catch (error) {
    const providerError = error instanceof ProviderSendError
      ? error
      : new ProviderSendError(error instanceof Error ? error.message : "Provider failure", "ambiguous", "provider_unknown");
    if (providerError.kind === "transient") {
      await db.update(messages).set({ status: "queued", lastError: providerError.code, updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId), eq(messages.status, "sending")));
      await recordAttempt({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: "retry", outcome: "transient_failure", errorCode: providerError.code });
      throw providerError;
    }
    const ambiguous = providerError.kind === "ambiguous";
    if (ambiguous) emitOperationalMetric("ProviderOutcomeUnknown");
    await db.transaction(async (tx) => {
      await tx.update(messages).set({ status: ambiguous ? "unknown" : "failed", ambiguousAt: ambiguous ? new Date() : null, lastError: providerError.code, updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
    });
    await recordAttempt({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: ambiguous ? "unknown" : "failed", outcome: ambiguous ? "ambiguous" : "definitive_failure", errorCode: providerError.code });
    await releaseReservation(claimed.workspaceId, claimed.queuedAt);
    if (!ambiguous) {
      await publishTerminalEvent({ workspaceId: claimed.workspaceId, messageId: claimed.id, provider: claimed.provider, status: "failed", errorCode: providerError.code });
    }
  }
}
