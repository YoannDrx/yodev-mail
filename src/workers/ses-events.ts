import { createHash } from "node:crypto";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  emailEvents,
  auditEvents,
  campaigns,
  contacts,
  messages,
  outboxJobs,
  suppressions,
  usageDays,
  usageLedger,
  usageMonths,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";
import {
  normalizeEmail,
  suppressionHash,
} from "@/features/contacts/normalization";
import {
  customerEventType,
  firstTag,
  monotonicMessageStatus,
  normalizeSesEventType,
  statusForSesEvent,
} from "@/workers/ses-event-utils";
import { shouldAutoPause } from "@/features/sending/policy";
import { utcDay } from "@/features/sending/eligibility";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

interface SesEnvelope {
  detail?: Record<string, unknown>;
  "detail-type"?: string;
  id?: string;
}

interface SesMail {
  messageId?: string;
  tags?: Record<string, string[]>;
  timestamp?: string;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await ingest(record.body);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

async function ingest(body: string) {
  const envelope = JSON.parse(body) as SesEnvelope;
  const detail = (envelope.detail ?? envelope) as Record<string, unknown>;
  const mail = (detail.mail ?? {}) as SesMail;
  const workspaceId = firstTag(mail.tags, "ym_workspace_id");
  const yodevMailMessageId = firstTag(mail.tags, "ym_message_id");
  const sesMessageId = mail.messageId;

  if (!workspaceId || (!yodevMailMessageId && !sesMessageId)) return;

  const db = requireDb();
  let message: typeof messages.$inferSelect | undefined;
  if (yodevMailMessageId) {
    [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.id, yodevMailMessageId),
        ),
      )
      .limit(1);
  }
  if (!message && sesMessageId) {
    [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.sesMessageId, sesMessageId),
        ),
      )
      .limit(1);
  }
  if (!message) return;

  const type = normalizeSesEventType(
    detail.eventType ?? detail.notificationType,
    envelope["detail-type"],
  );
  const eventType = customerEventType(type);
  const incomingStatus = statusForSesEvent(type);
  const occurredAt = new Date(mail.timestamp ?? Date.now());
  const externalEventId =
    envelope.id ??
    createHash("sha256")
      .update(`${sesMessageId ?? message.id}:${type}:${occurredAt.toISOString()}`)
      .digest("hex");

  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(emailEvents)
      .values({
        externalEventId,
        messageId: message.id,
        occurredAt,
        payload: detail,
        type: eventType,
        workspaceId: message.workspaceId,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;

    const acceptedAttempt = await tx
      .insert(usageLedger)
      .values({
        acceptedAt: occurredAt,
        messageId: message.id,
        workspaceId: message.workspaceId,
      })
      .onConflictDoNothing()
      .returning();
    if (acceptedAttempt.length) {
      const month = occurredAt.toISOString().slice(0, 7);
      await tx
        .insert(usageMonths)
        .values({ acceptedEmails: 1, month, workspaceId: message.workspaceId })
        .onConflictDoUpdate({
          target: [usageMonths.workspaceId, usageMonths.month],
          set: {
            acceptedEmails: sql`${usageMonths.acceptedEmails} + 1`,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(usageDays)
        .values({
          acceptedEmails: 1,
          day: utcDay(occurredAt),
          workspaceId: message.workspaceId,
        })
        .onConflictDoUpdate({
          target: [usageDays.workspaceId, usageDays.day],
          set: {
            acceptedEmails: sql`${usageDays.acceptedEmails} + 1`,
            updatedAt: new Date(),
          },
        });
      if (message.campaignId) {
        await tx
          .update(campaigns)
          .set({ acceptedCount: sql`${campaigns.acceptedCount} + 1`, updatedAt: new Date() })
          .where(and(eq(campaigns.id, message.campaignId), eq(campaigns.workspaceId, message.workspaceId)));
      }
    }

    if (incomingStatus) {
      const status = monotonicMessageStatus(message.status, incomingStatus);
      await tx
        .update(messages)
        .set({
          deliveredAt:
            incomingStatus === "delivered"
              ? message.deliveredAt ?? occurredAt
              : message.deliveredAt,
          sentAt:
            incomingStatus === "sent" ? message.sentAt ?? occurredAt : message.sentAt,
          sesMessageId: message.sesMessageId ?? sesMessageId,
          lastEventAt: occurredAt,
          status,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(messages.workspaceId, message.workspaceId),
            eq(messages.id, message.id),
          ),
        );
    }

    if (incomingStatus === "hard_bounced" || incomingStatus === "complained") {
      const normalizedEmail = normalizeEmail(message.toEmail);
      await tx
        .insert(suppressions)
        .values({
          emailHash: suppressionHash(normalizedEmail),
          normalizedEmail,
          reason: incomingStatus === "complained" ? "complaint" : "hard_bounce",
          sourceMessageId: message.id,
          workspaceId: message.workspaceId,
        })
        .onConflictDoNothing();
      if (message.contactId) {
        await tx
          .update(contacts)
          .set({ status: "suppressed", updatedAt: new Date() })
          .where(and(eq(contacts.id, message.contactId), eq(contacts.workspaceId, message.workspaceId)));
      }
    }

    const dayMetrics = {
      complaints: incomingStatus === "complained" ? 1 : 0,
      deliveredEmails: incomingStatus === "delivered" ? 1 : 0,
      failedEmails: incomingStatus === "failed" ? 1 : 0,
      hardBounces: incomingStatus === "hard_bounced" ? 1 : 0,
    };
    if (Object.values(dayMetrics).some(Boolean)) {
      await tx
        .insert(usageDays)
        .values({ day: utcDay(occurredAt), workspaceId: message.workspaceId, ...dayMetrics })
        .onConflictDoUpdate({
          target: [usageDays.workspaceId, usageDays.day],
          set: {
            complaints: dayMetrics.complaints ? sql`${usageDays.complaints} + 1` : sql`${usageDays.complaints}`,
            deliveredEmails: dayMetrics.deliveredEmails ? sql`${usageDays.deliveredEmails} + 1` : sql`${usageDays.deliveredEmails}`,
            failedEmails: dayMetrics.failedEmails ? sql`${usageDays.failedEmails} + 1` : sql`${usageDays.failedEmails}`,
            hardBounces: dayMetrics.hardBounces ? sql`${usageDays.hardBounces} + 1` : sql`${usageDays.hardBounces}`,
            updatedAt: new Date(),
          },
        });
    }

    if (message.campaignId && incomingStatus) {
      await tx
        .update(campaigns)
        .set({
          bouncedCount: incomingStatus === "hard_bounced" ? sql`${campaigns.bouncedCount} + 1` : sql`${campaigns.bouncedCount}`,
          complaintCount: incomingStatus === "complained" ? sql`${campaigns.complaintCount} + 1` : sql`${campaigns.complaintCount}`,
          deliveredCount: incomingStatus === "delivered" ? sql`${campaigns.deliveredCount} + 1` : sql`${campaigns.deliveredCount}`,
          failedCount: incomingStatus === "failed" ? sql`${campaigns.failedCount} + 1` : sql`${campaigns.failedCount}`,
          updatedAt: new Date(),
        })
        .where(and(eq(campaigns.id, message.campaignId), eq(campaigns.workspaceId, message.workspaceId)));
    }

    const endpoints = await tx
      .select()
      .from(webhookEndpoints)
      .where(
        and(
          eq(webhookEndpoints.workspaceId, message.workspaceId),
          eq(webhookEndpoints.enabled, true),
        ),
      );
    for (const endpoint of endpoints) {
      if (!endpoint.eventTypes.includes(eventType)) continue;
      const [delivery] = await tx
        .insert(webhookDeliveries)
        .values({
          workspaceId: message.workspaceId,
          endpointId: endpoint.id,
          eventId: inserted[0].id,
          nextAttemptAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (delivery) {
        await tx.insert(outboxJobs).values({
          aggregateId: delivery.id,
          kind: "webhook",
          workspaceId: message.workspaceId,
        });
      }
    }
  });

  if (incomingStatus === "hard_bounced" || incomingStatus === "complained") {
    const since = utcDay(new Date(Date.now() - 7 * 864e5));
    const [reputation] = await db
      .select({
        complaints: sql<number>`coalesce(sum(${usageDays.complaints}), 0)::int`,
        hardBounces: sql<number>`coalesce(sum(${usageDays.hardBounces}), 0)::int`,
        sent: sql<number>`coalesce(sum(${usageDays.acceptedEmails}), 0)::int`,
      })
      .from(usageDays)
      .where(and(eq(usageDays.workspaceId, message.workspaceId), gte(usageDays.day, since)));
    if (reputation && shouldAutoPause(reputation)) {
      const [paused] = await db
        .update(workspaces)
        .set({ pauseReason: "reputation", pausedAt: new Date(), status: "paused", updatedAt: new Date() })
        .where(and(eq(workspaces.id, message.workspaceId), eq(workspaces.status, "approved")))
        .returning({ id: workspaces.id });
      if (paused) {
        await db
          .update(campaigns)
          .set({ status: "paused", updatedAt: new Date() })
          .where(
            and(
              eq(campaigns.workspaceId, paused.id),
              inArray(campaigns.status, ["scheduled", "dispatching", "sending"]),
            ),
          );
        await db.insert(auditEvents).values({
          action: "workspace.auto_paused",
          actorUserId: "system:ses",
          entityId: paused.id,
          entityType: "workspace",
          metadata: reputation,
          workspaceId: paused.id,
        });
      }
    }
  }

}
