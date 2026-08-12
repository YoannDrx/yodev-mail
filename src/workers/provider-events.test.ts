import { describe, expect, it } from "vitest";
import { normalizeQueuedProviderEvent, normalizeSanitizedSesEvent } from "./ses-events";

describe("sanitized provider queue events", () => {
  it("normalizes SES lifecycle fields and drops unexpected personal data", () => {
    const event = normalizeSanitizedSesEvent({
      eventId: "event-1",
      eventType: "Delivery",
      providerMessageId: "provider-1",
      messageId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      occurredAt: "2026-08-12T12:00:00.000Z",
      recipient: "private@example.net",
      subject: "Private subject",
    } as Parameters<typeof normalizeSanitizedSesEvent>[0] & { recipient: string; subject: string });
    expect(event).toEqual({
      provider: "ses",
      externalEventId: "event-1",
      providerMessageId: "provider-1",
      messageId: "00000000-0000-0000-0000-000000000001",
      workspaceId: "00000000-0000-0000-0000-000000000002",
      type: "delivered",
      occurredAt: new Date("2026-08-12T12:00:00.000Z"),
      reasonCode: undefined,
    });
  });

  it("refuses unsupported tracking events and incomplete Postmark queue messages", () => {
    expect(normalizeSanitizedSesEvent({ eventType: "Open", providerMessageId: "provider-1", workspaceId: "workspace-1" })).toBeNull();
    expect(normalizeQueuedProviderEvent({ provider: "postmark", providerMessageId: "provider-1", type: "delivered" })).toBeNull();
  });
});
