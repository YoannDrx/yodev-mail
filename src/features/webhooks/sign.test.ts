import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signedWebhookHeaders } from "./sign";

describe("customer webhook signature contract", () => {
  it("signs `${timestamp}.${body}` with plain HMAC-SHA256 of the endpoint secret", () => {
    const body = JSON.stringify({ id: "evt", type: "webhook.test" });
    const headers = signedWebhookHeaders(body, "whsec_ym_fixture", new Date("2026-10-11T12:00:00.900Z"));
    expect(headers["x-yodev-mail-timestamp"]).toBe("1791720000");
    expect(headers["x-yodev-mail-signature"]).toBe(
      createHmac("sha256", "whsec_ym_fixture").update(`1791720000.${body}`).digest("hex"),
    );
    expect(headers["content-length"]).toBe(String(Buffer.byteLength(body)));
  });
});
