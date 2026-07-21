export type MessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "soft_bounced"
  | "hard_bounced"
  | "complained"
  | "suppressed"
  | "failed"
  | "unknown";

const statusRank: Record<MessageStatus, number> = {
  queued: 0,
  unknown: 0,
  sending: 1,
  sent: 2,
  soft_bounced: 3,
  delivered: 4,
  failed: 5,
  hard_bounced: 6,
  suppressed: 6,
  complained: 7,
};

const aliases: Record<string, string> = {
  DELIVERYDELAY: "DELIVERY_DELAY",
  "EMAIL BOUNCED": "BOUNCE",
  "EMAIL CLICKED": "CLICK",
  "EMAIL COMPLAINT RECEIVED": "COMPLAINT",
  "EMAIL DELIVERED": "DELIVERY",
  "EMAIL DELIVERY DELAYED": "DELIVERY_DELAY",
  "EMAIL OPENED": "OPEN",
  "EMAIL REJECTED": "REJECT",
  "EMAIL RENDERING FAILED": "RENDERING_FAILURE",
  "EMAIL SENT": "SEND",
  "EMAIL SUBSCRIBED": "SUBSCRIPTION",
  "RENDERING FAILURE": "RENDERING_FAILURE",
};

export function normalizeSesEventType(
  detailEventType?: unknown,
  detailType?: unknown,
) {
  const raw = String(detailEventType ?? detailType ?? "UNKNOWN")
    .trim()
    .toUpperCase();
  return (aliases[raw] ?? raw).replace(/[ -]+/g, "_");
}

export function statusForSesEvent(type: string): MessageStatus | undefined {
  return {
    BOUNCE: "hard_bounced",
    COMPLAINT: "complained",
    DELIVERY: "delivered",
    DELIVERY_DELAY: "soft_bounced",
    REJECT: "failed",
    SEND: "sent",
  }[type] as MessageStatus | undefined;
}

export function customerEventType(type: string) {
  return {
    BOUNCE: "bounced",
    COMPLAINT: "complained",
    DELIVERY: "delivered",
    DELIVERY_DELAY: "delivery_delayed",
    REJECT: "failed",
    SEND: "sent",
  }[type] ?? type.toLowerCase();
}

export function monotonicMessageStatus(
  current: MessageStatus,
  incoming: MessageStatus,
) {
  return statusRank[incoming] >= statusRank[current] ? incoming : current;
}

export function firstTag(
  tags: Record<string, string[]> | undefined,
  name: string,
) {
  const value = tags?.[name]?.[0];
  return typeof value === "string" && value.length ? value : undefined;
}
