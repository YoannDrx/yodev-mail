import { createHash } from "node:crypto";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { SendMessageBatchCommand, SQSClient } from "@aws-sdk/client-sqs";
import { and, eq, sql } from "drizzle-orm";
import { requireDb } from "@/db";
import {
  emailEvents,
  messageAttempts,
  messages,
  suppressions,
  usageMonths,
  webhookDeliveries,
  webhookEndpoints,
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
  const workspaceId = firstTag(mail.tags, "vm_workspace_id");
  const vigiemailMessageId = firstTag(mail.tags, "vm_message_id");
  const sesMessageId = mail.messageId;

  if (!workspaceId || (!vigiemailMessageId && !sesMessageId)) return;

  const db = requireDb();
  let message: typeof messages.$inferSelect | undefined;
  if (vigiemailMessageId) {
    [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.id, vigiemailMessageId),
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
  const deliveryIds: string[] = [];

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
      .insert(messageAttempts)
      .values({ messageId: message.id, attempt: 1, status: "accepted" })
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
          endpointId: endpoint.id,
          eventId: inserted[0].id,
          nextAttemptAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
      if (delivery) deliveryIds.push(delivery.id);
    }
  });

  const queueUrl = process.env.WEBHOOK_QUEUE_URL;
  if (!queueUrl || !deliveryIds.length) return;

  const sqs = new SQSClient({});
  for (let start = 0; start < deliveryIds.length; start += 10) {
    await sqs.send(
      new SendMessageBatchCommand({
        Entries: deliveryIds.slice(start, start + 10).map((deliveryId, index) => ({
          Id: String(start + index),
          MessageBody: JSON.stringify({ deliveryId }),
        })),
        QueueUrl: queueUrl,
      }),
    );
  }
}
