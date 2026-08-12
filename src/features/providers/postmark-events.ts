import { createHash } from "node:crypto";
import { z } from "zod";
import type { NormalizedProviderEvent } from "@/features/providers/normalize-event";

type PostmarkWebhook = {
  RecordType?: string;
  MessageID?: string;
  ID?: number;
  Type?: string;
  TypeCode?: number;
  ServerID?: number;
  DeliveredAt?: string;
  BouncedAt?: string;
  ReceivedAt?: string;
  Metadata?: Record<string, string>;
};

const webhookSchema = z.object({
  RecordType: z.enum(["Delivery", "Bounce", "SpamComplaint"]),
  MessageID: z.string().min(8).max(180),
  ServerID: z.number().int().positive(),
  ID: z.number().int().optional(),
  Type: z.string().max(120).optional(),
  TypeCode: z.number().int().optional(),
  DeliveredAt: z.string().datetime({ offset: true }).optional(),
  BouncedAt: z.string().datetime({ offset: true }).optional(),
  ReceivedAt: z.string().datetime({ offset: true }).optional(),
  Metadata: z.record(z.string(), z.string().max(180)).optional(),
}).passthrough();

export function parsePostmarkWebhook(value: unknown): PostmarkWebhook {
  return webhookSchema.parse(value);
}

export function normalizePostmarkEvent(payload: PostmarkWebhook): NormalizedProviderEvent | null {
  if (!payload.MessageID || !payload.RecordType) return null;
  const recordType = payload.RecordType.toLowerCase();
  const type = recordType === "delivery"
    ? "delivered"
    : recordType === "spamcomplaint"
      ? "complained"
      : recordType === "bounce"
        ? payload.TypeCode === 1 || payload.Type === "HardBounce" ? "hard_bounced" : "soft_bounced"
        : null;
  if (!type) return null;
  const occurredAt = new Date(payload.DeliveredAt ?? payload.BouncedAt ?? payload.ReceivedAt ?? Date.now());
  const externalEventId = payload.ID
    ? `${recordType}:${payload.ID}`
    : createHash("sha256").update(`${payload.MessageID}:${recordType}:${occurredAt.toISOString()}`).digest("hex");
  return {
    provider: "postmark",
    externalEventId,
    providerMessageId: payload.MessageID,
    messageId: payload.Metadata?.ym_message_id,
    workspaceId: payload.Metadata?.ym_workspace_id,
    type,
    occurredAt,
    reasonCode: payload.Type,
  };
}
