import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  emailEvents,
  webhookDeliveries,
  webhookEndpoints,
} from "@/db/schema";
import { decryptSecret, hmac } from "@/lib/crypto";
import { validateWebhookUrl } from "@/features/webhooks/validate-url";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const failed: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await deliver(JSON.parse(record.body).deliveryId);
    } catch {
      failed.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failed };
}

async function deliver(deliveryId: string) {
  const db = requireDb();
  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      endpoint: webhookEndpoints,
      event: emailEvents,
    })
    .from(webhookDeliveries)
    .innerJoin(
      webhookEndpoints,
      eq(webhookDeliveries.endpointId, webhookEndpoints.id),
    )
    .innerJoin(emailEvents, eq(webhookDeliveries.eventId, emailEvents.id))
    .where(
      and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.workspaceId, webhookEndpoints.workspaceId),
        eq(webhookDeliveries.workspaceId, emailEvents.workspaceId),
      ),
    )
    .limit(1);
  if (!row || row.delivery.deliveredAt || !row.endpoint.enabled) return;

  const body = JSON.stringify({
    created_at: row.event.occurredAt,
    data: { message_id: row.event.messageId },
    id: row.event.id,
    type: `email.${row.event.type.toLowerCase()}`,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const encryptionKey = process.env.WEBHOOK_SIGNING_SECRET;
  if (!encryptionKey) throw new Error("WEBHOOK_SIGNING_SECRET is missing");
  const signingSecret = decryptSecret(
    row.endpoint.signingSecretEncrypted,
    encryptionKey,
  );
  const safeUrl = await validateWebhookUrl(row.endpoint.url);

  try {
    const response = await fetch(safeUrl, {
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": "Yodev-Mail-Webhooks/1.0",
        "x-yodev-mail-signature": hmac(
          `${timestamp}.${body}`,
          signingSecret,
        ),
        "x-yodev-mail-timestamp": String(timestamp),
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
    await db
      .update(webhookDeliveries)
      .set({
        attempt: row.delivery.attempt + 1,
        deliveredAt: new Date(),
        lastError: null,
        statusCode: response.status,
        updatedAt: new Date(),
      })
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.workspaceId, row.delivery.workspaceId)));
  } catch (error) {
    const attempt = row.delivery.attempt + 1;
    await db
      .update(webhookDeliveries)
      .set({
        attempt,
        lastError: error instanceof Error ? error.message : "Webhook delivery failed",
        nextAttemptAt: new Date(Date.now() + Math.min(3600, 2 ** attempt) * 1000),
        updatedAt: new Date(),
      })
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.workspaceId, row.delivery.workspaceId)));
    throw error;
  }
}
