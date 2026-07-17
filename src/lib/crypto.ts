import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function constantTimeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createApiKey(mode: "test" | "live", pepper: string) {
  const prefix = mode === "test" ? "vm_test_" : "vm_live_";
  const secret = randomBytes(30).toString("base64url");
  const token = `${prefix}${secret}`;
  return {
    token,
    prefix: `${prefix}${secret.slice(0, 8)}`,
    secretHash: hmac(token, pepper),
  };
}

export function signExpiringToken(payload: Record<string, string>, secret: string, expiresAt: Date) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: expiresAt.getTime() })).toString("base64url");
  return `${body}.${hmac(body, secret)}`;
}

export function verifyExpiringToken(token: string, secret: string) {
  const [body, signature] = token.split(".");
  if (!body || !signature || !constantTimeEqual(hmac(body, secret), signature)) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, string> & { exp: number };
  if (!Number.isFinite(data.exp) || data.exp < Date.now()) return null;
  return data;
}

