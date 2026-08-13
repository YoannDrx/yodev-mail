import { beforeEach, describe, expect, it, vi } from "vitest";

const dns = vi.hoisted(() => ({ resolve4: vi.fn(), resolve6: vi.fn() }));
vi.mock("node:dns/promises", () => dns);
import { validateWebhookUrl } from "./validate-url";

describe("customer webhook URL validation", () => {
  beforeEach(() => {
    dns.resolve4.mockResolvedValue(["203.0.113.10"]);
    dns.resolve6.mockResolvedValue(["2001:db8::10"]);
  });

  it("accepts HTTPS hosts only when every current DNS answer is public", async () => {
    await expect(validateWebhookUrl("https://hooks.example.test/events")).resolves.toBe("https://hooks.example.test/events");
    dns.resolve4.mockResolvedValueOnce(["203.0.113.10", "10.0.0.2"]);
    await expect(validateWebhookUrl("https://hooks.example.test/events")).rejects.toThrow(/publiques/);
  });

  it("rejects private IPv4 and IPv6 literals, credentials, ports and non-HTTPS URLs", async () => {
    await expect(validateWebhookUrl("https://127.0.0.1/hook")).rejects.toThrow(/privée/);
    await expect(validateWebhookUrl("https://[::1]/hook")).rejects.toThrow(/privée/);
    await expect(validateWebhookUrl("https://user:pass@example.test/hook")).rejects.toThrow(/interdits/);
    await expect(validateWebhookUrl("https://example.test:8443/hook")).rejects.toThrow(/interdits/);
    await expect(validateWebhookUrl("http://example.test/hook")).rejects.toThrow(/HTTPS/);
  });
});
