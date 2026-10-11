import { describe, expect, it } from "vitest";
import { normalizePostmarkEvent, parsePostmarkWebhook } from "./postmark-events";

const messageId = "00000000-0000-0000-0000-000000000001";

describe("Postmark webhook normalization", () => {
  it("normalizes a delivery without carrying recipient or content fields", () => {
    const parsed = parsePostmarkWebhook({
      RecordType: "Delivery",
      MessageID: messageId,
      ServerID: 42,
      DeliveredAt: "2026-08-12T12:00:00.000Z",
      Recipient: "private@example.net",
      Subject: "Private subject",
      Metadata: {
        ym_message_id: messageId,
        ym_workspace_id: "00000000-0000-0000-0000-000000000002",
      },
    });
    const normalized = normalizePostmarkEvent(parsed);
    expect(normalized).toMatchObject({ provider: "postmark", type: "delivered", providerMessageId: messageId });
    expect(normalized).not.toHaveProperty("Recipient");
    expect(normalized).not.toHaveProperty("Subject");
  });

  it("separates hard and soft bounces", () => {
    const common = { RecordType: "Bounce" as const, MessageID: messageId, ServerID: 42, BouncedAt: "2026-08-12T12:00:00.000Z" };
    expect(normalizePostmarkEvent({ ...common, Type: "HardBounce", TypeCode: 1 })?.type).toBe("hard_bounced");
    expect(normalizePostmarkEvent({ ...common, Type: "Transient", TypeCode: 2 })?.type).toBe("soft_bounced");
    // An invalid address can never receive mail: suppress it like a hard bounce.
    expect(normalizePostmarkEvent({ ...common, Type: "BadEmailAddress", TypeCode: 100000 })?.type).toBe("hard_bounced");
    expect(normalizePostmarkEvent({ ...common, TypeCode: 100000 })?.type).toBe("hard_bounced");
    expect(normalizePostmarkEvent({ ...common, Type: "BadEmailAddress" })?.type).toBe("hard_bounced");
    // An ISP block is about content or the sending IP, not the recipient.
    for (const [Type, TypeCode] of [["Blocked", 100006], ["SoftBounce", 4096], ["DnsError", 256], ["ManuallyDeactivated", 100002], ["AutoResponder", 64]] as const) {
      expect(normalizePostmarkEvent({ ...common, Type, TypeCode })?.type).toBe("soft_bounced");
    }
  });

  it("rejects unsupported event types and malformed server identifiers", () => {
    expect(() => parsePostmarkWebhook({ RecordType: "Open", MessageID: messageId, ServerID: 42 })).toThrow();
    expect(() => parsePostmarkWebhook({ RecordType: "Delivery", MessageID: messageId, ServerID: "42" })).toThrow();
  });
});
