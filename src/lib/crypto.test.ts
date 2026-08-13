import { describe, expect, it } from "vitest";
import { canonicalJson, createApiKey, sha256 } from "./crypto";

describe("crypto helpers", () => {
  it("creates scoped API keys without storing the token", () => {
    const key = createApiKey("test", "a-very-long-pepper-value");
    expect(key.token).toMatch(/^ym_test_/);
    expect(key.secretHash).toHaveLength(64);
    expect(key.secretHash).not.toContain(key.token);
  });

  it("hashes deterministically", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });

  it("canonicalizes object keys recursively without changing array order", () => {
    expect(canonicalJson({ z: 1, nested: { b: true, a: "x" }, list: [2, 1] }))
      .toBe(canonicalJson({ list: [2, 1], nested: { a: "x", b: true }, z: 1 }));
    expect(canonicalJson({ list: [1, 2] })).not.toBe(canonicalJson({ list: [2, 1] }));
  });
});
