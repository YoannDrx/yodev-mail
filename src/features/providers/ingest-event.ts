import { and, eq, gte, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  auditEvents,
  emailEvents,
  messages,
  outboxJobs,
  suppressions,
  usageDays,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";
import { normalizeEmail, suppressionHash } from "@/features/email-address/normalization";
import type { NormalizedProviderEvent } from "@/features/providers/normalize-event";
import { shouldAutoPause } from "@/features/sending/policy";
import { utcDay } from "@/features/sending/eligibility";
import { isFeatureEnabled } from "@/lib/env";
import { monotonicMessageStatus } from "@/workers/ses-event-utils";

export async function ingestProviderEvent(event: NormalizedProviderEvent) {
  const db = requireDb();
  let locatedMessage: typeof messages.$inferSelect | undefined;
  if (event.messageId && event.workspaceId) {
    [locatedMessage] = await db.select().from(messages).where(and(
      eq(messages.id, event.messageId),
      eq(messages.workspaceId, event.workspaceId),
      eq(messages.provider, event.provider),
    )).limit(1);
  }
  if (!locatedMessage && event.workspaceId) {
    [locatedMessage] = await db.select().from(messages).where(and(
      eq(messages.workspaceId, event.workspaceId),
      eq(messages.provider, event.provider),
      eq(messages.providerMessageId, event.providerMessageId),
    )).limit(1);
  }
  if (!locatedMessage) return { skipped: true };

  const ingested = await db.transaction(async (tx) => {
    await tx.execute(sql`
      select ${messages.id}
      from ${messages}
      where ${messages.id} = ${locatedMessage.id}
        and ${messages.workspaceId} = ${locatedMessage.workspaceId}
      for update
    `);
    const [message] = await tx.select().from(messages).where(and(
      eq(messages.id, locatedMessage.id),
      eq(messages.workspaceId, locatedMessage.workspaceId),
    )).limit(1);
    if (!message) return null;
    const [inserted] = await tx.insert(emailEvents).values({
      workspaceId: message.workspaceId,
      messageId: message.id,
      provider: event.provider,
      externalEventId: event.externalEventId,
      type: `email.${event.type}`,
      occurredAt: event.occurredAt,
      payload: event.reasonCode ? { reasonCode: event.reasonCode } : {},
    }).onConflictDoNothing().returning();
    if (!inserted) return { inserted: false, message };
    const safetyEvent = event.type === "hard_bounced" || event.type === "complained";
    const stale = Boolean(message.lastEventAt && event.occurredAt < message.lastEventAt);
    const status = stale && !safetyEvent
      ? message.status
      : monotonicMessageStatus(message.status, event.type);
    await tx.update(messages).set({
      status,
      deliveredAt: event.type === "delivered" ? message.deliveredAt ?? event.occurredAt : message.deliveredAt,
      failedAt: event.type === "failed" ? message.failedAt ?? event.occurredAt : message.failedAt,
      lastEventAt: message.lastEventAt && message.lastEventAt > event.occurredAt
        ? message.lastEventAt
        : event.occurredAt,
      providerMessageId: message.providerMessageId ?? event.providerMessageId,
      updatedAt: new Date(),
    }).where(and(eq(messages.id, message.id), eq(messages.workspaceId, message.workspaceId)));

    if (event.type === "hard_bounced" || event.type === "complained") {
      const normalizedEmail = normalizeEmail(message.toEmail);
      await tx.insert(suppressions).values({
        workspaceId: message.workspaceId,
        normalizedEmail,
        emailHash: suppressionHash(normalizedEmail),
        reason: event.type === "complained" ? "complaint" : "hard_bounce",
        sourceMessageId: message.id,
        provider: event.provider,
      }).onConflictDoNothing();
    }

    const metrics = {
      complaints: event.type === "complained" ? 1 : 0,
      deliveredEmails: event.type === "delivered" ? 1 : 0,
      failedEmails: event.type === "failed" ? 1 : 0,
      hardBounces: event.type === "hard_bounced" ? 1 : 0,
    };
    if (Object.values(metrics).some(Boolean)) {
      await tx.insert(usageDays).values({ day: utcDay(event.occurredAt), workspaceId: message.workspaceId, ...metrics }).onConflictDoUpdate({
        target: [usageDays.workspaceId, usageDays.day],
        set: {
          complaints: metrics.complaints ? sql`${usageDays.complaints} + 1` : usageDays.complaints,
          deliveredEmails: metrics.deliveredEmails ? sql`${usageDays.deliveredEmails} + 1` : usageDays.deliveredEmails,
          failedEmails: metrics.failedEmails ? sql`${usageDays.failedEmails} + 1` : usageDays.failedEmails,
          hardBounces: metrics.hardBounces ? sql`${usageDays.hardBounces} + 1` : usageDays.hardBounces,
          updatedAt: new Date(),
        },
      });
    }
    const endpoints = isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED")
      ? await tx.select().from(webhookEndpoints).where(and(
          eq(webhookEndpoints.workspaceId, message.workspaceId),
          eq(webhookEndpoints.enabled, true),
        ))
      : [];
    for (const endpoint of endpoints) {
      if (!endpoint.eventTypes.includes(`email.${event.type}`)) continue;
      const [delivery] = await tx.insert(webhookDeliveries).values({
        workspaceId: message.workspaceId,
        endpointId: endpoint.id,
        eventId: inserted.id,
        nextAttemptAt: new Date(),
      }).onConflictDoNothing().returning();
      if (delivery) await tx.insert(outboxJobs).values({ workspaceId: message.workspaceId, aggregateId: delivery.id, kind: "webhook" });
    }
    return { inserted: true, message };
  });

  if (!ingested) return { skipped: true };
  const { message } = ingested;
  if (ingested.inserted && (event.type === "hard_bounced" || event.type === "complained")) {
    const since = utcDay(new Date(Date.now() - 7 * 864e5));
    const [reputation] = await db.select({
      complaints: sql<number>`coalesce(sum(${usageDays.complaints}), 0)::int`,
      hardBounces: sql<number>`coalesce(sum(${usageDays.hardBounces}), 0)::int`,
      sent: sql<number>`coalesce(sum(${usageDays.acceptedEmails}), 0)::int`,
    }).from(usageDays).where(and(eq(usageDays.workspaceId, message.workspaceId), gte(usageDays.day, since)));
    if (reputation && shouldAutoPause(reputation)) {
      await db.transaction(async (tx) => {
        const [paused] = await tx.update(workspaces)
          .set({ status: "paused", pauseReason: "reputation", pausedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(workspaces.id, message.workspaceId), eq(workspaces.status, "approved")))
          .returning({ id: workspaces.id });
        if (paused) {
          await tx.insert(auditEvents).values({
            workspaceId: message.workspaceId,
            actorUserId: "system:reputation",
            action: "workspace.auto_paused",
            entityType: "workspace",
            entityId: message.workspaceId,
            metadata: {
              reason: "reputation",
              complaints: reputation.complaints,
              hardBounces: reputation.hardBounces,
              acceptedEmails: reputation.sent,
              windowDays: 7,
            },
          });
        }
      });
    }
  }
  return { skipped: false, duplicate: !ingested.inserted };
}
