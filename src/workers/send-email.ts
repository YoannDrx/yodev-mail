import { DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  attachments,
  messageAttempts,
  messages,
  stripeUsageReportJobs,
  subscriptions,
  usageDays,
  usageLedger,
  usageMonths,
  workspaceProviderAccounts,
} from "@/db/schema";
import { deliveryProvider } from "@/features/providers/registry";
import { ProviderSendError } from "@/features/providers/types";
import { evaluateStoredMessage, utcDay } from "@/features/sending/eligibility";
import {
  type DatabaseTransaction,
  queuePublicEmailEventInTransaction,
} from "@/features/webhooks/public-email-event";
import { stripeMeterableSubscriptionStatuses } from "@/features/billing/stripe-state";
import { awsClients } from "@/lib/aws";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { logWorkerResult } from "@/lib/worker-log";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await sendOne(JSON.parse(record.body).messageId);
      logWorkerResult({ worker: "send-email", correlationId: record.messageId, outcome: "completed" });
    } catch {
      logWorkerResult({ worker: "send-email", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

async function releaseReservationInTransaction(
  tx: DatabaseTransaction,
  workspaceId: string,
  reservedAt: Date,
) {
  await tx
    .update(usageDays)
    .set({
      reservedEmails: sql`greatest(${usageDays.reservedEmails} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(and(eq(usageDays.workspaceId, workspaceId), eq(usageDays.day, utcDay(reservedAt))));
}

type AttemptInput = {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark";
  status: string;
  outcome: "accepted" | "definitive_failure" | "transient_failure" | "ambiguous";
  errorCode?: string;
};

async function recordAttemptInTransaction(
  tx: DatabaseTransaction,
  input: AttemptInput,
) {
  const [latest] = await tx.select({ value: sql<number>`coalesce(max(${messageAttempts.attempt}), 0)::int` })
    .from(messageAttempts).where(and(
      eq(messageAttempts.messageId, input.messageId),
      eq(messageAttempts.workspaceId, input.workspaceId),
    ));
  await tx.insert(messageAttempts).values({ ...input, attempt: (latest?.value ?? 0) + 1 });
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
    await requireDb().update(attachments).set({ fileName: "[deleted]", status: "deleted", deletedAt: new Date(), updatedAt: new Date() }).where(and(
      eq(attachments.id, attachment.id),
      eq(attachments.workspaceId, attachment.workspaceId),
    ));
  }
}

async function finalizeTerminalMessage(input: {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark" | null;
  status: "failed" | "suppressed";
  errorCode: string;
  errorMessage: string;
  outcome?: AttemptInput["outcome"];
}) {
  return requireDb().transaction(async (tx) => {
    const terminalAt = new Date();
    const [updated] = await tx.update(messages).set({
      status: input.status,
      failedAt: input.status === "failed" ? terminalAt : null,
      lastError: input.errorMessage,
      updatedAt: terminalAt,
    }).where(and(
      eq(messages.id, input.messageId),
      eq(messages.workspaceId, input.workspaceId),
      eq(messages.status, "sending"),
    )).returning({ queuedAt: messages.queuedAt });
    if (!updated) return false;
    await releaseReservationInTransaction(
      tx,
      input.workspaceId,
      updated.queuedAt,
    );
    if (input.provider && input.outcome) {
      await recordAttemptInTransaction(tx, {
        workspaceId: input.workspaceId,
        messageId: input.messageId,
        provider: input.provider,
        status: input.status,
        outcome: input.outcome,
        errorCode: input.errorCode,
      });
    }
    await queuePublicEmailEventInTransaction(tx, {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      provider: input.provider,
      type: input.status === "suppressed" ? "email.suppressed" : "email.failed",
      occurredAt: terminalAt,
      errorCode: input.errorCode,
    });
    return true;
  });
}

async function finalizeTerminalMessageOrRequeue(
  input: Parameters<typeof finalizeTerminalMessage>[0],
) {
  try {
    return await finalizeTerminalMessage(input);
  } catch (error) {
    await requireDb().update(messages).set({
      status: "queued",
      lastError: "terminal_persistence_failed",
      updatedAt: new Date(),
    }).where(and(
      eq(messages.id, input.messageId),
      eq(messages.workspaceId, input.workspaceId),
      eq(messages.status, "sending"),
    ));
    throw error;
  }
}

async function finalizeUnknownMessage(input: {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark";
  errorCode: string;
}) {
  return requireDb().transaction(async (tx) => {
    const terminalAt = new Date();
    const [updated] = await tx.update(messages).set({
      status: "unknown",
      ambiguousAt: terminalAt,
      failedAt: null,
      lastError: input.errorCode,
      updatedAt: terminalAt,
    }).where(and(
      eq(messages.id, input.messageId),
      eq(messages.workspaceId, input.workspaceId),
      eq(messages.status, "sending"),
    )).returning({ queuedAt: messages.queuedAt });
    if (!updated) return false;
    await releaseReservationInTransaction(
      tx,
      input.workspaceId,
      updated.queuedAt,
    );
    await recordAttemptInTransaction(tx, {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      provider: input.provider,
      status: "unknown",
      outcome: "ambiguous",
      errorCode: input.errorCode,
    });
    return true;
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
    await finalizeTerminalMessageOrRequeue({
      workspaceId: claimed.workspaceId,
      messageId: claimed.id,
      provider: claimed.provider,
      status: "failed",
      errorCode: "provider_assignment_missing",
      errorMessage: "Provider assignment is missing.",
    });
    return;
  }
  const provider = claimed.provider;
  if (claimed.sendDeadlineAt && claimed.sendDeadlineAt <= new Date()) {
    await finalizeTerminalMessageOrRequeue({
      workspaceId: claimed.workspaceId,
      messageId: claimed.id,
      provider,
      status: "failed",
      errorCode: "send_deadline_exceeded",
      errorMessage: "send_deadline_exceeded",
      outcome: "definitive_failure",
    });
    return;
  }

  const eligibility = await evaluateStoredMessage(db, {
    domainId: claimed.domainId,
    mode: claimed.sendMode,
    profileId: claimed.transactionalProfileId,
    provider,
    toEmail: claimed.toEmail,
    workspaceId: claimed.workspaceId,
  });
  if (!eligibility.allowed) {
    const status = eligibility.code === "recipient_suppressed" ? "suppressed" : "failed";
    await finalizeTerminalMessageOrRequeue({
      workspaceId: claimed.workspaceId,
      messageId: claimed.id,
      provider,
      status,
      errorCode: eligibility.code,
      errorMessage: eligibility.reason,
      outcome: "definitive_failure",
    });
    return;
  }

  const [account] = await db.select().from(workspaceProviderAccounts).where(and(
    eq(workspaceProviderAccounts.workspaceId, claimed.workspaceId),
    eq(workspaceProviderAccounts.provider, provider),
    eq(workspaceProviderAccounts.status, "ready"),
  )).limit(1);
  if (!account?.externalAccountId) {
    await finalizeTerminalMessageOrRequeue({
      workspaceId: claimed.workspaceId,
      messageId: claimed.id,
      provider,
      status: "failed",
      errorCode: "provider_account_unavailable",
      errorMessage: "Provider account is unavailable.",
      outcome: "definitive_failure",
    });
    return;
  }

  let loaded: Awaited<ReturnType<typeof loadAttachments>>;
  let result: Awaited<ReturnType<ReturnType<typeof deliveryProvider>["send"]>>;
  try {
    loaded = await loadAttachments(claimed.id, claimed.workspaceId);
    result = await deliveryProvider(provider).send({
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
  } catch (error) {
    const providerError = error instanceof ProviderSendError
      ? error
      : new ProviderSendError(error instanceof Error ? error.message : "Provider failure", "ambiguous", "provider_unknown");
    if (providerError.kind === "transient") {
      let requeued: boolean;
      try {
        requeued = await db.transaction(async (tx) => {
          const [updated] = await tx.update(messages).set({
            status: "queued",
            lastError: providerError.code,
            updatedAt: new Date(),
          }).where(and(
            eq(messages.id, claimed.id),
            eq(messages.workspaceId, claimed.workspaceId),
            eq(messages.status, "sending"),
          )).returning({ id: messages.id });
          if (!updated) return false;
          await recordAttemptInTransaction(tx, {
            workspaceId: claimed.workspaceId,
            messageId: claimed.id,
            provider,
            status: "retry",
            outcome: "transient_failure",
            errorCode: providerError.code,
          });
          return true;
        });
      } catch (persistenceError) {
        await db.update(messages).set({
          status: "queued",
          lastError: "transient_persistence_failed",
          updatedAt: new Date(),
        }).where(and(
          eq(messages.id, claimed.id),
          eq(messages.workspaceId, claimed.workspaceId),
          eq(messages.status, "sending"),
        ));
        throw persistenceError;
      }
      if (requeued) throw providerError;
      return;
    }
    if (providerError.kind === "ambiguous") {
      const updated = await finalizeUnknownMessage({
        workspaceId: claimed.workspaceId,
        messageId: claimed.id,
        provider,
        errorCode: providerError.code,
      });
      if (updated) emitOperationalMetric("ProviderOutcomeUnknown");
      return;
    }
    await finalizeTerminalMessageOrRequeue({
      workspaceId: claimed.workspaceId,
      messageId: claimed.id,
      provider,
      status: "failed",
      errorCode: providerError.code,
      errorMessage: providerError.message,
      outcome: "definitive_failure",
    });
    return;
  }

  try {
    const acceptedAt = result.acceptedAt;
    const month = acceptedAt.toISOString().slice(0, 7);
    await db.transaction(async (tx) => {
      const [sentMessage] = await tx.update(messages).set({
        status: "sent",
        providerMessageId: result.providerMessageId,
        acceptedAt,
        providerAcceptedAt: acceptedAt,
        sentAt: acceptedAt,
        lastError: null,
        updatedAt: acceptedAt,
      }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId), eq(messages.status, "sending")))
        .returning({ id: messages.id });
      if (!sentMessage) {
        throw new ProviderSendError(
          "Provider accepted the message but the local state transition was lost.",
          "ambiguous",
          "provider_accepted_state_conflict",
        );
      }
      const ledger = await tx.insert(usageLedger).values({ acceptedAt, messageId: claimed.id, workspaceId: claimed.workspaceId }).onConflictDoNothing().returning();
      if (ledger.length) {
        const [billableSubscription] = await tx.select({
          customerId: subscriptions.stripeCustomerId,
          id: subscriptions.stripeSubscriptionId,
        }).from(subscriptions).where(and(
          eq(subscriptions.workspaceId, claimed.workspaceId),
          inArray(subscriptions.status, [...stripeMeterableSubscriptionStatuses]),
          eq(subscriptions.plan, "beta"),
        )).limit(1);
        if (billableSubscription?.customerId && billableSubscription.id) {
          await tx.insert(stripeUsageReportJobs).values({
            workspaceId: claimed.workspaceId,
            messageId: claimed.id,
            acceptedAt,
            stripeIdentifier: `ym-${claimed.id}`,
            stripeCustomerId: billableSubscription.customerId,
            stripeSubscriptionId: billableSubscription.id,
          }).onConflictDoNothing();
        }
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
      await recordAttemptInTransaction(tx, {
        workspaceId: claimed.workspaceId,
        messageId: claimed.id,
        provider,
        status: "accepted",
        outcome: "accepted",
      });
      await queuePublicEmailEventInTransaction(tx, {
        workspaceId: claimed.workspaceId,
        messageId: claimed.id,
        provider,
        type: "email.sent",
        occurredAt: acceptedAt,
      });
    });
  } catch {
    const updated = await finalizeUnknownMessage({
      workspaceId: claimed.workspaceId,
      messageId: claimed.id,
      provider,
      errorCode: "provider_accepted_persistence_failed",
    });
    if (updated) emitOperationalMetric("ProviderOutcomeUnknown");
    return;
  }
  try { await purgeAttachments(loaded.rows); } catch { /* lifecycle remains the final deletion guarantee */ }
}
