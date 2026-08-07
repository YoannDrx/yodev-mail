import { describe, expect, it } from "vitest";
import { createApiKey, sha256, signExpiringToken, verifyExpiringToken } from "./crypto";

describe("crypto helpers", () => {
  it("creates scoped API keys without storing the token", () => {
    const key = createApiKey("test", "a-very-long-pepper-value");
    expect(key.token).toMatch(/^ym_test_/);
    expect(key.secretHash).toHaveLength(64);
    expect(key.secretHash).not.toContain(key.token);
  });

  it("signs and verifies expiring unsubscribe tokens", () => {
    const token = signExpiringToken({ workspaceId: "w", contactId: "c" }, "long-signing-secret", new Date(Date.now() + 1_000));
    expect(verifyExpiringToken(token, "long-signing-secret")?.contactId).toBe("c");
    expect(verifyExpiringToken(`${token}x`, "long-signing-secret")).toBeNull();
  });

  it("hashes deterministically", () => {
    expect(sha256("hello")).toBe(sha256("hello"));
  });
});
