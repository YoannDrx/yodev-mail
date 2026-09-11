import { describe, expect, test } from "vitest";
import { parseTransportEvent, transportSendInput } from "./certify-ses-transport.mjs";

const receipt = { environment: "dev" as const, workspaceId: "11111111-1111-4111-8111-111111111111", messageId: "22222222-2222-4222-8222-222222222222", providerMessageId: "opaque-provider-id" };
const event = { ...receipt, eventId: "event-id", eventType: "Delivery", occurredAt: "2026-09-11T10:00:00Z" };

describe("SES transport probe safety", () => {
  test("pins the two sends to existing test identities and success simulator", () => {
    for (const environment of ["dev", "prod"] as const) {
      const input = transportSendInput(environment, receipt.workspaceId, receipt.messageId);
      expect(input.Destination).toEqual({ ToAddresses: ["success@simulator.amazonses.com"] });
      expect(input.FromEmailAddress).toBe(`probe@${environment}.ses-probe-20260910a.yodev.fr`);
      expect(input.TenantName).toBe(`ym-${environment}-ses-probe-20260910a`);
      expect(input.EmailTags).toEqual([{ Name: "ym_workspace_id", Value: receipt.workspaceId }, { Name: "ym_message_id", Value: receipt.messageId }, { Name: "ym_environment", Value: environment }]);
      expect(JSON.stringify(input.EmailTags)).not.toContain("@");
    }
  });
  test("rejects arbitrary environment, addresses and invalid identifiers before sending", () => {
    expect(() => transportSendInput("other" as "dev", receipt.workspaceId, receipt.messageId)).toThrow();
    expect(() => transportSendInput("dev", "private@example.test", receipt.messageId)).toThrow();
    expect(() => transportSendInput("dev", receipt.workspaceId, "not-uuid")).toThrow();
  });
  test("keeps an empty optional path visible to the real consumer, without normalizing it away", () => {
    expect(parseTransportEvent(JSON.stringify(event), receipt)).toEqual(event);
    expect(parseTransportEvent(JSON.stringify({ ...event, bounceType: "" }), receipt).bounceType).toBe("");
  });
  test("does not acknowledge another message, workspace, environment or provider ID", () => {
    for (const extra of [{ workspaceId: receipt.messageId }, { messageId: receipt.workspaceId }, { environment: "prod" }, { providerMessageId: "another" }]) {
      expect(() => parseTransportEvent(JSON.stringify({ ...event, ...extra }), receipt)).toThrow("TransportCorrelationMismatch");
    }
  });
  test("rejects raw provider data, unknown fields and malformed contracts with a fixed diagnostic", () => {
    for (const value of [null, [], { ...event, mail: { destination: ["private@example.test"] } }, { ...event, recipient: "private@example.test" }, { ...event, providerMessageId: "private@example.test" }, { ...event, occurredAt: "yesterday" }, { ...event, bounceType: "private content" }]) {
      expect(() => parseTransportEvent(JSON.stringify(value), receipt)).toThrow("TransportEnvelopeInvalidOrNotPrivate");
    }
    expect(() => parseTransportEvent("private content", receipt)).toThrow("TransportBodyNotJson");
  });
});
