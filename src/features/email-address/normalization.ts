import { createHash } from "node:crypto";

export function normalizeEmail(email: string) {
  const value = email.trim();
  const separator = value.lastIndexOf("@");
  if (separator <= 0) return value.toLowerCase();
  return `${value.slice(0, separator).toLowerCase()}@${value.slice(separator + 1).toLowerCase()}`;
}

export function suppressionHash(email: string) {
  return createHash("sha256").update(normalizeEmail(email)).digest("hex");
}
