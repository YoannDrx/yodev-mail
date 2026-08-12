import { describe, expect, it } from "vitest";
import { createApiKey, sha256 } from "./crypto";

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
});
