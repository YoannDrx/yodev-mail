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

// Postmark bounce types (https://postmarkapp.com/developer/api/bounce-api).
// Only the types proving that the recipient address itself can never receive
// mail are hard: they suppress the recipient and count toward auto-pause.
// - HardBounce (1): unknown user or mailbox not found.
// - BadEmailAddress (100000): the address is not a valid email address.
// Deliberately soft: Blocked (100006) is an ISP block caused by content or a
// blacklisted sending IP, not by the recipient, so suppressing would punish a
// valid address; ManuallyDeactivated, DnsError, SoftBounce, Transient and the
// notification types are temporary or not about the address either.
const PERMANENT_RECIPIENT_BOUNCES = new Map<number, string>([
  [1, "HardBounce"],
  [100000, "BadEmailAddress"],
]);

function isPermanentRecipientBounce(payload: { Type?: string; TypeCode?: number }) {
  return (payload.TypeCode !== undefined && PERMANENT_RECIPIENT_BOUNCES.has(payload.TypeCode))
    || [...PERMANENT_RECIPIENT_BOUNCES.values()].includes(payload.Type ?? "");
}

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
        ? isPermanentRecipientBounce(payload) ? "hard_bounced" : "soft_bounced"
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
