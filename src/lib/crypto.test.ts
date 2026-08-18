import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  constantTimeEqual,
  createApiKey,
  decryptSecret,
  encryptSecret,
  hmac,
  sha256,
} from "./crypto";

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
});
