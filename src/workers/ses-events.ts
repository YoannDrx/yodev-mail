import { createHash } from "node:crypto";
import { z } from "zod";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ingestProviderEvent } from "@/features/providers/ingest-event";
import type { NormalizedProviderEvent } from "@/features/providers/normalize-event";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";
import { logWorkerResult } from "@/lib/worker-log";
import { eventOpaqueId, eventTimestamp, eventWorkspaceId, safeEventReason } from "@/features/providers/event-contract";

const correlationFields = {
  providerMessageId: eventOpaqueId,
  messageId: eventWorkspaceId.optional(),
  workspaceId: eventWorkspaceId,
  occurredAt: eventTimestamp,
  reasonCode: z.unknown().optional(),
};
const sesSchema = z.object({
  ...correlationFields,
  environment: z.enum(["dev", "prod"]),
  provider: z.literal("ses").optional(),
  eventId: eventOpaqueId.optional(),
  eventType: z.string().min(1).max(48),
  // EventBridge supplies "" for the missing bounce JSONPath on non-bounce
  // lifecycle events. Keep this transport representation distinct from a bounce.
  bounceType: z.enum(["", "Permanent", "Transient", "Undetermined"]).optional(),
});
const postmarkSchema = z.object({
  ...correlationFields,
  provider: z.literal("postmark"),
  externalEventId: eventOpaqueId,
  type: z.enum(["sent", "delivered", "soft_bounced", "hard_bounced", "complained", "failed"]),
});

function normalizeType(value: string | undefined, bounceType?: string): NormalizedProviderEvent["type"] | null {
  switch (value?.trim().toUpperCase().replace(/[ -]+/g, "_")) {
    case "SEND": return "sent";
    case "DELIVERY": return "delivered";
    case "DELIVERY_DELAY":
    case "DELIVERYDELAY": return "soft_bounced";
    case "BOUNCE": return bounceType?.toUpperCase() === "PERMANENT" ? "hard_bounced" : "soft_bounced";
    case "COMPLAINT": return "complained";
    case "REJECT": return "failed";
    default: return null;
  }
}

export function normalizeSanitizedSesEvent(value: unknown): NormalizedProviderEvent | null {
  const parsed = sesSchema.safeParse(value);
  if (!parsed.success) return null;
  const input = parsed.data;
  // Also defend against direct queue publication or a misconfigured rule.
  // Never infer an environment from a copied workspace UUID or default to prod.
  if (input.environment !== process.env.DEPLOYMENT_ENVIRONMENT) return null;
  if (input.bounceType === "" && input.eventType.trim().toUpperCase() === "BOUNCE") return null;
  const type = normalizeType(input.eventType, input.bounceType);
  if (!type || !input.providerMessageId || !input.workspaceId) return null;
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return null;
  return {
    provider: "ses",
    externalEventId: input.eventId ?? createHash("sha256")
      .update(`${input.providerMessageId}:${type}:${occurredAt.toISOString()}`)
      .digest("hex"),
    providerMessageId: input.providerMessageId,
    messageId: input.messageId,
    workspaceId: input.workspaceId,
    type,
    occurredAt,
    reasonCode: safeEventReason(input.reasonCode) ?? safeEventReason(input.bounceType),
  };
}

export function normalizeQueuedProviderEvent(value: unknown): NormalizedProviderEvent | null {
  const parsed = postmarkSchema.safeParse(value);
  if (!parsed.success) return normalizeSanitizedSesEvent(value);
  const input = parsed.data;
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return null;
  return {
    provider: "postmark",
    externalEventId: input.externalEventId,
    providerMessageId: input.providerMessageId,
    messageId: input.messageId,
    workspaceId: input.workspaceId,
    type: input.type,
    occurredAt,
    reasonCode: safeEventReason(input.reasonCode),
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const normalized = normalizeQueuedProviderEvent(JSON.parse(record.body));
      if (!normalized) {
        logWorkerResult({ worker: "provider-events", correlationId: record.messageId, outcome: "failed", code: "invalid_event" });
        batchItemFailures.push({ itemIdentifier: record.messageId });
        continue;
      }
      const result = await ingestProviderEvent(normalized);
      logWorkerResult({ worker: "provider-events", correlationId: record.messageId, outcome: result.skipped ? "skipped" : "completed" });
    } catch {
      logWorkerResult({ worker: "provider-events", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
