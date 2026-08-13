const retryDelaysMs = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  8 * 60 * 60_000,
  24 * 60 * 60_000,
  36 * 60 * 60_000,
] as const;

export const MAX_WEBHOOK_ATTEMPTS = 8;

export function nextWebhookAttemptAt(completedAttempts: number, now = new Date()) {
  if (completedAttempts >= MAX_WEBHOOK_ATTEMPTS) return null;
  const delay = retryDelaysMs[completedAttempts - 1];
  if (delay === undefined) throw new Error("Invalid webhook attempt count");
  return new Date(now.getTime() + delay);
}
