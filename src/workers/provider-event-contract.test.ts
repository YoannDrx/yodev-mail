import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQSEvent } from "aws-lambda";
import { handler, normalizeQueuedProviderEvent } from "./ses-events";
import { normalizePostmarkEvent, parsePostmarkWebhook } from "@/features/providers/postmark-events";

const mocks = vi.hoisted(() => ({ ingest: vi.fn(), load: vi.fn(), log: vi.fn() }));
vi.mock("@/features/providers/ingest-event", () => ({ ingestProviderEvent: mocks.ingest }));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: mocks.load }));
vi.mock("@/lib/worker-log", () => ({ logWorkerResult: mocks.log }));

const workspaceId = "00000000-0000-0000-0000-000000000002";
const messageId = "00000000-0000-0000-0000-000000000001";
const occurredAt = "2026-09-07T00:00:00.000Z";
const ses = { eventType: "Delivery", providerMessageId: "provider-1", workspaceId, messageId, occurredAt };
const postmark = { provider: "postmark", externalEventId: "delivery:123", providerMessageId: "provider-1", workspaceId, messageId, occurredAt, type: "delivered" };

beforeEach(() => { vi.resetAllMocks(); mocks.ingest.mockResolvedValue({ skipped: false }); });
afterEach(() => vi.useRealTimers());

describe("provider event runtime contract", () => {
  it.each([null, [], true, 42, "event", { ...ses, eventType: 1 }, { ...ses, bounceType: {} }])("rejects malformed values without throwing: %j", (value) => {
    expect(normalizeQueuedProviderEvent(value as never)).toBeNull();
  });
  it.each([ses, postmark])("requires stable time, scoped opaque identifiers and a recognized provider", (valid) => {
    for (const invalid of [
      { ...valid, occurredAt: undefined }, { ...valid, occurredAt: "2026-02-30T00:00:00Z" },
      { ...valid, workspaceId: undefined }, { ...valid, workspaceId: "not-a-uuid" },
      { ...valid, messageId: "not-a-uuid" }, { ...valid, providerMessageId: "private@example.net" },
      { ...valid, provider: "unknown" }, { ...valid, providerMessageId: "x".repeat(181) },
    ]) expect(normalizeQueuedProviderEvent(invalid as never)).toBeNull();
  });
  it("rejects an arbitrary Postmark lifecycle type", () => {
    expect(normalizeQueuedProviderEvent({ ...postmark, type: "opened" } as never)).toBeNull();
  });
  it("does not persist free-form reason data", () => {
    for (const valid of [ses, postmark]) {
      const event = normalizeQueuedProviderEvent({ ...valid, reasonCode: "private@example.net: private content" } as never);
      expect(event).not.toBeNull();
      expect(JSON.stringify(event)).not.toContain("private");
    }
  });
  it("keeps the same fallback identity across retries and permits absent message metadata", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T01:00:00Z"));
    const first = normalizeQueuedProviderEvent({ ...ses, messageId: undefined });
    vi.advanceTimersByTime(60_000);
    expect(first).not.toBeNull();
    expect(normalizeQueuedProviderEvent({ ...ses, messageId: undefined })).toEqual(first);
  });
  it.each([
    { RecordType: "Delivery", DeliveredAt: undefined },
    { RecordType: "Delivery", BouncedAt: occurredAt },
    { RecordType: "Bounce", BouncedAt: undefined },
    { RecordType: "SpamComplaint", ReceivedAt: undefined },
  ])("rejects a Postmark webhook without its lifecycle timestamp: %j", (fields) => {
    const payload = { MessageID: messageId, ServerID: 42, ...fields };
    expect(() => parsePostmarkWebhook(payload)).toThrow();
    expect(normalizePostmarkEvent(payload)).toBeNull();
  });
  it("removes arbitrary Postmark Type before queue publication", () => {
    const payload = parsePostmarkWebhook({ RecordType: "Bounce", MessageID: messageId, ServerID: 42, BouncedAt: occurredAt, Type: "private@example.net", Metadata: { ym_workspace_id: workspaceId, ym_message_id: messageId } });
    expect(JSON.stringify(normalizePostmarkEvent(payload))).not.toContain("private");
  });
  it("accepts documented Postmark complaints with BouncedAt and preserves their stable identity", () => {
    const event = normalizePostmarkEvent(parsePostmarkWebhook({ RecordType: "SpamComplaint", MessageID: messageId, ServerID: 42, ID: 692560174, Type: "SpamComplaint", BouncedAt: "2026-09-07T00:00:00.9070259Z", Metadata: { ym_workspace_id: workspaceId } }));
    expect(event).toMatchObject({ externalEventId: "spamcomplaint:692560174", type: "complained", occurredAt: new Date("2026-09-07T00:00:00.907Z") });
    expect(normalizeQueuedProviderEvent(JSON.parse(JSON.stringify(event)))).toEqual(event);
  });
  it("rejects a complaint with only a non-contract timestamp", () => {
    expect(() => parsePostmarkWebhook({ RecordType: "SpamComplaint", MessageID: messageId, ServerID: 42, ReceivedAt: occurredAt })).toThrow();
  });
  it("retries only invalid or failed records in a mixed SQS batch, without logging payloads", async () => {
    mocks.ingest.mockResolvedValueOnce({ skipped: false }).mockRejectedValueOnce(new Error("private@example.net"));
    const bodies = [JSON.stringify(ses), "{private@example.net", JSON.stringify({ ...postmark, type: "opened" }), JSON.stringify(postmark)];
    const event = { Records: bodies.map((body, index) => ({ messageId: `record-${index}`, body })) } as SQSEvent;
    expect(await handler(event)).toEqual({ batchItemFailures: [
      { itemIdentifier: "record-1" }, { itemIdentifier: "record-2" }, { itemIdentifier: "record-3" },
    ] });
    expect(mocks.ingest).toHaveBeenCalledTimes(2);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ correlationId: "record-2", code: "invalid_event" }));
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private");
  });
  it("logs an uncorrelated event as skipped, not completed", async () => {
    mocks.ingest.mockResolvedValue({ skipped: true });
    expect(await handler({ Records: [{ messageId: "record-1", body: JSON.stringify(ses) }] } as SQSEvent)).toEqual({ batchItemFailures: [] });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "skipped" }));
  });
  it("does not acknowledge the batch when runtime initialization fails", async () => {
    mocks.load.mockRejectedValue(new Error("runtime unavailable"));
    await expect(handler({ Records: [] })).rejects.toThrow("runtime unavailable");
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
});
