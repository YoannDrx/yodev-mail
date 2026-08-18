import { and, eq } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  emailEvents,
  outboxJobs,
  webhookDeliveries,
  webhookEndpoints,
} from "@/db/schema";
import { isFeatureEnabled } from "@/lib/env";

type Database = ReturnType<typeof requireDb>;
export type DatabaseTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export type PublicEmailEventType =
  | "email.queued"
  | "email.sent"
  | "email.delivered"
  | "email.soft_bounced"
  | "email.hard_bounced"
  | "email.complained"
  | "email.failed"
  | "email.suppressed";

export type PublicEmailEventInput = {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark" | null;
  type: PublicEmailEventType;
  occurredAt?: Date;
  errorCode?: string;
};

export async function queuePublicEmailEventInTransaction(
  tx: DatabaseTransaction,
  input: PublicEmailEventInput,
) {
  const occurredAt = input.occurredAt ?? new Date();
  const [event] = await tx
    .insert(emailEvents)
    .values({
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      provider: input.provider,
      externalEventId: `yodev:${input.type}:${input.messageId}`,
      type: input.type,
      occurredAt,
      payload: input.errorCode ? { errorCode: input.errorCode } : {},
    })
    .onConflictDoNothing()
    .returning();
  if (!event || !isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED")) return;
  const endpoints = await tx
    .select()
    .from(webhookEndpoints)
    .where(and(
      eq(webhookEndpoints.workspaceId, input.workspaceId),
      eq(webhookEndpoints.enabled, true),
    ));
  for (const endpoint of endpoints) {
    if (!endpoint.eventTypes.includes(input.type)) continue;
    const [delivery] = await tx
      .insert(webhookDeliveries)
      .values({
        workspaceId: input.workspaceId,
        endpointId: endpoint.id,
        eventId: event.id,
        nextAttemptAt: occurredAt,
      })
      .onConflictDoNothing()
      .returning();
    if (delivery) {
      await tx.insert(outboxJobs).values({
        workspaceId: input.workspaceId,
        aggregateId: delivery.id,
        kind: "webhook",
      });
    }
  }
}

export async function queuePublicEmailEvent(input: PublicEmailEventInput) {
  await requireDb().transaction((tx) =>
    queuePublicEmailEventInTransaction(tx, input),
  );
}
