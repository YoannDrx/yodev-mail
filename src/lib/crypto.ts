import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
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
  const prefix = mode === "test" ? "ym_test_" : "ym_live_";
  const secret = randomBytes(30).toString("base64url");
  const token = `${prefix}${secret}`;
  return {
    token,
    prefix: `${prefix}${secret.slice(0, 8)}`,
    secretHash: hmac(token, pepper),
  };
}

// Values encrypted before key separation used SHA-256(keyMaterial) directly as
// the AES key, and the same material also keyed HMAC digests. New values use
// HKDF subkeys bound to their purpose and carry a version prefix; legacy
// three-part values stay readable so stored webhook secrets keep working.
const ENCRYPTION_VERSION = "v2";
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

type KeyPurpose = "secret-encryption" | "secret-digest";

export function deriveSubkey(keyMaterial: string, purpose: KeyPurpose) {
  return Buffer.from(hkdfSync("sha256", keyMaterial, "yodev-mail", `yodev-mail/${purpose}/v2`, 32));
}

function legacyEncryptionKey(keyMaterial: string) {
  return createHash("sha256").update(keyMaterial).digest();
}

// Digest of a stored secret, keyed with a subkey that never encrypts anything.
export function secretDigest(value: string, keyMaterial: string) {
  return createHmac("sha256", deriveSubkey(keyMaterial, "secret-digest")).update(value).digest("hex");
}

export function encryptSecret(value: string, keyMaterial: string) {
  const key = deriveSubkey(keyMaterial, "secret-encryption");
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    ENCRYPTION_VERSION,
    ...[iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")),
  ].join(".");
}

export function decryptSecret(value: string, keyMaterial: string) {
  const parts = value.split(".");
  const versioned = parts.length === 4 && parts[0] === ENCRYPTION_VERSION;
  if (!versioned && parts.length !== 3) {
    throw new Error("Encrypted secret has an invalid format");
  }
  const [ivValue, tagValue, encryptedValue] = versioned ? parts.slice(1) : parts;
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Encrypted secret has an invalid format");
  }
  const iv = Buffer.from(ivValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  // A truncated tag would make forgeries far cheaper: accept only the full
  // 128-bit tag that encryptSecret has always produced.
  if (iv.length !== GCM_IV_BYTES || tag.length !== GCM_TAG_BYTES) {
    throw new Error("Encrypted secret has an invalid format");
  }
  const key = versioned ? deriveSubkey(keyMaterial, "secret-encryption") : legacyEncryptionKey(keyMaterial);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: GCM_TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
