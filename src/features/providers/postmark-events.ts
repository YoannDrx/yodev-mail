import { createHash } from "node:crypto";
import { z } from "zod";
import type { NormalizedProviderEvent } from "@/features/providers/normalize-event";
import { eventOpaqueId, eventTimestamp, eventWorkspaceId, safeEventReason } from "./event-contract";

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
  MessageID: eventOpaqueId,
  ServerID: z.number().int().positive(),
  ID: z.number().int().positive().safe().optional(),
  Type: z.string().max(120).optional(),
  TypeCode: z.number().int().optional(),
  DeliveredAt: eventTimestamp.optional(),
  BouncedAt: eventTimestamp.optional(),
  ReceivedAt: eventTimestamp.optional(),
  Metadata: z.object({
    ym_message_id: eventWorkspaceId.optional(),
    ym_workspace_id: eventWorkspaceId.optional(),
  }).optional(),
}).refine((payload) => Boolean(payload.RecordType === "Delivery"
  ? payload.DeliveredAt : payload.BouncedAt),
{ message: "Missing lifecycle timestamp" });

export function parsePostmarkWebhook(value: unknown): PostmarkWebhook {
  return webhookSchema.parse(value);
}

export function normalizePostmarkEvent(value: PostmarkWebhook): NormalizedProviderEvent | null {
  const parsed = webhookSchema.safeParse(value);
  if (!parsed.success) return null;
  const payload = parsed.data;
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
  // Postmark complaints, like bounces, use BouncedAt (not ReceivedAt).
  const timestamp = payload.RecordType === "Delivery" ? payload.DeliveredAt : payload.BouncedAt;
  if (!timestamp) return null;
  const occurredAt = new Date(timestamp);
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
    reasonCode: safeEventReason(payload.Type),
  };
}
