import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  constantTimeEqual,
  createApiKey,
  decryptSecret,
  encryptSecret,
  deriveSubkey,
  hmac,
  secretDigest,
  sha256,
} from "./crypto";

// Exact copy of the pre-versioning encryptSecret, kept to prove that values
// already stored in production remain readable.
function legacyEncryptSecret(value: string, keyMaterial: string, tagLength = 16) {
  const key = createHash("sha256").update(keyMaterial).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: tagLength });
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

describe("crypto helpers", () => {
  it("creates scoped API keys without storing the token", () => {
    const key = createApiKey("test", "a-very-long-pepper-value");
    expect(key.token).toMatch(/^ym_test_/);
    expect(key.secretHash).toHaveLength(64);
    expect(key.secretHash).not.toContain(key.token);
  });

  it("hashes deterministically", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
    expect(hmac("hello", "secret")).toBe(hmac("hello", "secret"));
    expect(constantTimeEqual("same", "same")).toBe(true);
    expect(constantTimeEqual("short", "different-length")).toBe(false);
    expect(constantTimeEqual("same", "diff")).toBe(false);
  });

  it("canonicalizes object keys recursively without changing array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: "x" }, list: [2, 1] }))
      .toBe(canonicalJson({ list: [2, 1], nested: { a: "x", b: true }, z: 1 }));
    expect(canonicalJson({ list: [1, 2] })).not.toBe(canonicalJson({ list: [2, 1] }));
    expect(canonicalJson([undefined, null])).toBe("[null,null]");
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("round-trips encrypted values and rejects malformed payloads", () => {
    const encrypted = encryptSecret("credential-value", "test-key-material");
    expect(encrypted).not.toContain("credential-value");
    expect(decryptSecret(encrypted, "test-key-material")).toBe("credential-value");
    expect(() => decryptSecret("malformed", "test-key-material")).toThrow("invalid format");
    expect(() => decryptSecret(encrypted, "wrong-key-material")).toThrow();
  });

  it("writes versioned values with a purpose-bound subkey", () => {
    const encrypted = encryptSecret("whsec_ym_value", "test-key-material");
    expect(encrypted.split(".")).toHaveLength(4);
    expect(encrypted.startsWith("v2.")).toBe(true);
    expect(deriveSubkey("test-key-material", "secret-encryption"))
      .not.toEqual(createHash("sha256").update("test-key-material").digest());
    expect(deriveSubkey("test-key-material", "secret-encryption"))
      .not.toEqual(deriveSubkey("test-key-material", "secret-digest"));
    expect(secretDigest("whsec_ym_value", "test-key-material")).not.toBe(hmac("whsec_ym_value", "test-key-material"));
    expect(secretDigest("whsec_ym_value", "test-key-material")).toHaveLength(64);
  });

  it("still decrypts every value written before versioning", () => {
    for (const value of ["whsec_ym_legacy", "accentué ✉️", "x".repeat(4_000)]) {
      expect(decryptSecret(legacyEncryptSecret(value, "test-key-material"), "test-key-material")).toBe(value);
    }
    expect(() => decryptSecret(legacyEncryptSecret("value", "test-key-material"), "wrong-key-material")).toThrow();
  });

  it("refuses truncated authentication tags and malformed versions", () => {
    expect(() => decryptSecret(legacyEncryptSecret("value", "test-key-material", 4), "test-key-material")).toThrow("invalid format");
    expect(() => decryptSecret(legacyEncryptSecret("value", "test-key-material", 12), "test-key-material")).toThrow("invalid format");
    const [, iv, tag, encrypted] = encryptSecret("value", "test-key-material").split(".");
    const shortTag = Buffer.from(tag, "base64url").subarray(0, 8).toString("base64url");
    expect(() => decryptSecret(["v2", iv, shortTag, encrypted].join("."), "test-key-material")).toThrow("invalid format");
    expect(() => decryptSecret(["v3", iv, tag, encrypted].join("."), "test-key-material")).toThrow("invalid format");
    // A versioned value is never readable with the legacy derivation and vice versa.
    expect(() => decryptSecret([iv, tag, encrypted].join("."), "test-key-material")).toThrow();
  });

  it("keeps API key hashes and webhook signatures byte-for-byte stable", () => {
    // Stored API key hashes and signatures already verified by customers are
    // plain HMAC-SHA256 with the pepper or the endpoint secret: never derived.
    const key = createApiKey("live", "a-very-long-pepper-value");
    expect(key.secretHash).toBe(createHmac("sha256", "a-very-long-pepper-value").update(key.token).digest("hex"));
    expect(hmac("1700000000.{}", "whsec_ym_fixture")).toBe(createHmac("sha256", "whsec_ym_fixture").update("1700000000.{}").digest("hex"));
  });
});
