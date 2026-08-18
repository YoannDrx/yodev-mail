import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { emailEvents, outboxJobs, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { nextWebhookAttemptAt } from "@/features/webhooks/retry-policy";
import { postWebhookSafely } from "@/features/webhooks/safe-http";
import { validateWebhookUrl } from "@/features/webhooks/validate-url";
import { decryptSecret, hmac } from "@/lib/crypto";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { logWorkerResult } from "@/lib/worker-log";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets(["DATABASE_URL", "WEBHOOK_SIGNING_SECRET"]);
  const failed: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await deliverWebhook(JSON.parse(record.body).deliveryId);
      logWorkerResult({ worker: "deliver-webhook", correlationId: record.messageId, outcome: "completed" });
    } catch {
      logWorkerResult({ worker: "deliver-webhook", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      failed.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failed };
}

async function recordExpectedFailure(input: {
  deliveryId: string;
  workspaceId: string;
  attempt: number;
  errorCode: string;
  statusCode?: number;
  claimedAt: Date;
  now: Date;
}) {
  const db = requireDb();
  const nextAttemptAt = nextWebhookAttemptAt(input.attempt, input.now);
  const terminal = await db.transaction(async (tx) => {
    const [updated] = await tx.update(webhookDeliveries).set({
      attempt: input.attempt,
      claimedAt: null,
      lastError: input.errorCode,
      nextAttemptAt,
      statusCode: input.statusCode,
      terminalAt: nextAttemptAt ? null : input.now,
      updatedAt: input.now,
    }).where(and(
      eq(webhookDeliveries.id, input.deliveryId),
      eq(webhookDeliveries.workspaceId, input.workspaceId),
      eq(webhookDeliveries.claimedAt, input.claimedAt),
      isNull(webhookDeliveries.deliveredAt),
      isNull(webhookDeliveries.terminalAt),
    )).returning({ id: webhookDeliveries.id });
    if (!updated) return false;
    if (nextAttemptAt) {
      await tx.insert(outboxJobs).values({
        workspaceId: input.workspaceId,
        aggregateId: input.deliveryId,
        availableAt: nextAttemptAt,
        kind: "webhook",
      });
    }
    return !nextAttemptAt;
  });
  if (terminal) emitOperationalMetric("CustomerWebhookTerminalFailure");
}

export async function deliverWebhook(deliveryId: string, now = new Date()) {
  const db = requireDb();
  const [row] = await db.select({ delivery: webhookDeliveries, endpoint: webhookEndpoints, event: emailEvents })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookDeliveries.endpointId, webhookEndpoints.id))
    .innerJoin(emailEvents, eq(webhookDeliveries.eventId, emailEvents.id))
    .where(and(
      eq(webhookDeliveries.id, deliveryId),
      eq(webhookDeliveries.workspaceId, webhookEndpoints.workspaceId),
      eq(webhookDeliveries.workspaceId, emailEvents.workspaceId),
    )).limit(1);
  if (!row || row.delivery.deliveredAt || row.delivery.terminalAt || !row.endpoint.enabled) return;
  if (row.delivery.nextAttemptAt && row.delivery.nextAttemptAt > now) return;

  const encryptionKey = process.env.WEBHOOK_SIGNING_SECRET;
  if (!encryptionKey) throw new Error("WEBHOOK_SIGNING_SECRET is missing");
  const signingSecret = decryptSecret(row.endpoint.signingSecretEncrypted, encryptionKey);
  const staleClaim = new Date(now.getTime() - 2 * 60_000);
  const [claimed] = await db.update(webhookDeliveries).set({ claimedAt: now, updatedAt: now }).where(and(
    eq(webhookDeliveries.id, deliveryId),
    eq(webhookDeliveries.workspaceId, row.delivery.workspaceId),
    isNull(webhookDeliveries.deliveredAt),
    isNull(webhookDeliveries.terminalAt),
    or(isNull(webhookDeliveries.nextAttemptAt), lte(webhookDeliveries.nextAttemptAt, now)),
    or(isNull(webhookDeliveries.claimedAt), lt(webhookDeliveries.claimedAt, staleClaim)),
  )).returning({ id: webhookDeliveries.id });
  if (!claimed) throw new Error("Webhook delivery is already claimed");

  const body = JSON.stringify({
    created_at: row.event.occurredAt,
    data: { message_id: row.event.messageId },
    id: row.event.id,
    type: row.event.type,
  });
  const timestamp = Math.floor(now.getTime() / 1000);
  const attempt = row.delivery.attempt + 1;

  let safeUrl: string;
  try {
    safeUrl = await validateWebhookUrl(row.endpoint.url);
  } catch {
    await recordExpectedFailure({ deliveryId, workspaceId: row.delivery.workspaceId, attempt, errorCode: "webhook_url_rejected", claimedAt: now, now });
    return;
  }

  try {
    const statusCode = await postWebhookSafely({
      url: safeUrl,
      body,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(body)),
        "user-agent": "Yodev-Mail-Webhooks/1.0",
        "x-yodev-mail-signature": hmac(`${timestamp}.${body}`, signingSecret),
        "x-yodev-mail-timestamp": String(timestamp),
      },
      timeoutMs: 10_000,
    });
    if (statusCode < 200 || statusCode >= 300) {
      await recordExpectedFailure({ deliveryId, workspaceId: row.delivery.workspaceId, attempt, errorCode: `http_${statusCode}`, statusCode, claimedAt: now, now });
      return;
    }
    await db.update(webhookDeliveries).set({
      attempt,
      claimedAt: null,
      deliveredAt: now,
      lastError: null,
      nextAttemptAt: null,
      statusCode,
      updatedAt: now,
    }).where(and(
      eq(webhookDeliveries.id, deliveryId),
      eq(webhookDeliveries.workspaceId, row.delivery.workspaceId),
      eq(webhookDeliveries.claimedAt, now),
      isNull(webhookDeliveries.deliveredAt),
      isNull(webhookDeliveries.terminalAt),
    ));
  } catch {
    await recordExpectedFailure({ deliveryId, workspaceId: row.delivery.workspaceId, attempt, errorCode: "network_error", claimedAt: now, now });
  }
}
