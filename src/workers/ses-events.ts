import { createHash } from "node:crypto";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { ingestProviderEvent } from "@/features/providers/ingest-event";
import type { NormalizedProviderEvent } from "@/features/providers/normalize-event";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";
import { logWorkerResult } from "@/lib/worker-log";

type SanitizedSesEvent = {
  provider?: "ses" | "postmark";
  externalEventId?: string;
  eventId?: string;
  eventType?: string;
  providerMessageId?: string;
  messageId?: string;
  workspaceId?: string;
  occurredAt?: string;
  bounceType?: string;
  reasonCode?: string;
};

function normalizeType(value: string | undefined): NormalizedProviderEvent["type"] | null {
  switch (value?.trim().toUpperCase().replace(/[ -]+/g, "_")) {
    case "SEND": return "sent";
    case "DELIVERY": return "delivered";
    case "DELIVERY_DELAY":
    case "DELIVERYDELAY": return "soft_bounced";
    case "BOUNCE": return "hard_bounced";
    case "COMPLAINT": return "complained";
    case "REJECT": return "failed";
    default: return null;
  }
}

export function normalizeSanitizedSesEvent(input: SanitizedSesEvent): NormalizedProviderEvent | null {
  const type = normalizeType(input.eventType);
  if (!type || !input.providerMessageId || !input.workspaceId) return null;
  const occurredAt = new Date(input.occurredAt ?? Date.now());
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
    reasonCode: input.reasonCode ?? input.bounceType,
  };
}

export function normalizeQueuedProviderEvent(input: SanitizedSesEvent & {
  type?: NormalizedProviderEvent["type"];
}): NormalizedProviderEvent | null {
  if (input.provider !== "postmark") return normalizeSanitizedSesEvent(input);
  if (!input.externalEventId || !input.providerMessageId || !input.type) return null;
  const occurredAt = new Date(input.occurredAt ?? Date.now());
  if (Number.isNaN(occurredAt.getTime())) return null;
  return {
    provider: "postmark",
    externalEventId: input.externalEventId,
    providerMessageId: input.providerMessageId,
    messageId: input.messageId,
    workspaceId: input.workspaceId,
    type: input.type,
    occurredAt,
    reasonCode: input.reasonCode ?? input.bounceType,
  };
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const normalized = normalizeQueuedProviderEvent(JSON.parse(record.body));
      if (normalized) await ingestProviderEvent(normalized);
      logWorkerResult({ worker: "provider-events", correlationId: record.messageId, outcome: normalized ? "completed" : "skipped" });
    } catch {
      logWorkerResult({ worker: "provider-events", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
