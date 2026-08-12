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
  });

  it("rejects unsupported event types and malformed server identifiers", () => {
    expect(() => parsePostmarkWebhook({ RecordType: "Open", MessageID: messageId, ServerID: 42 })).toThrow();
    expect(() => parsePostmarkWebhook({ RecordType: "Delivery", MessageID: messageId, ServerID: "42" })).toThrow();
  });
});
