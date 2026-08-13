import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/workers/runtime-secrets", () => ({ getSecureParameter: vi.fn(async () => "server-token") }));
import { PostmarkDeliveryProvider } from "./postmark";

const input = {
  messageId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  externalAccountId: "42",
  credentialParameterName: "/test/server-token",
  from: { email: "sender@example.test", name: "Sender" },
  to: { email: "recipient@example.test" },
  subject: "Subject",
  html: "<p>Hello</p>",
  text: "Hello",
  attachments: [],
};

describe("Postmark delivery contract", () => {
  beforeEach(() => {
    process.env.POSTMARK_ENABLED = "true";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.POSTMARK_ENABLED;
  });

  it("disables tracking and sends only opaque metadata", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ErrorCode: 0, MessageID: "pm-1", SubmittedAt: "2026-08-13T12:00:00Z" }), { status: 200 }));
    await new PostmarkDeliveryProvider().send(input);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ MessageStream: "outbound", TrackOpens: false, TrackLinks: "None", Metadata: { ym_message_id: input.messageId, ym_workspace_id: input.workspaceId } });
    expect(body.Metadata).not.toHaveProperty("recipient");
  });

  it("classifies 429 and 5xx as transient, 4xx as definitive, and network timeouts as ambiguous", async () => {
    for (const [status, kind] of [[429, "transient"], [503, "transient"], [422, "definitive"]] as const) {
      vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ErrorCode: status, Message: "rejected" }), { status }));
      await expect(new PostmarkDeliveryProvider().send(input)).rejects.toMatchObject({ kind });
    }
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timeout"));
    await expect(new PostmarkDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "ambiguous", code: "provider_outcome_unknown" });
  });

  it("classifies malformed successful responses as ambiguous", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("{}", { status: 200 }));
    await expect(new PostmarkDeliveryProvider().send(input)).rejects.toMatchObject({ kind: "ambiguous", code: "provider_outcome_unknown" });
  });
});
