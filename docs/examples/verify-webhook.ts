import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyYodevMailWebhook(input: {
  rawBody: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const timestampMs = Number(input.timestamp) * 1000;
  if (!/^\d{10}$/.test(input.timestamp) || timestampMs < now.getTime() - 300_000 || timestampMs > now.getTime() + 60_000) return false;
  const expected = createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
  const left = Buffer.from(input.signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
