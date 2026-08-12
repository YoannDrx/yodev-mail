export type MessageStatus =
  | "simulated"
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
  simulated: 0,
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

export function monotonicMessageStatus(
  current: MessageStatus,
  incoming: MessageStatus,
) {
  return statusRank[incoming] >= statusRank[current] ? incoming : current;
}
