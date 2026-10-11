import { hmac } from "@/lib/crypto";

// The public signing contract: HMAC-SHA256 over `${timestamp}.${body}` keyed
// with the endpoint secret. Customers already verify it, never change it.
export function signedWebhookHeaders(body: string, signingSecret: string, now: Date) {
  const timestamp = Math.floor(now.getTime() / 1000);
  return {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(body)),
    "user-agent": "Yodev-Mail-Webhooks/1.0",
    "x-yodev-mail-signature": hmac(`${timestamp}.${body}`, signingSecret),
    "x-yodev-mail-timestamp": String(timestamp),
  };
}
