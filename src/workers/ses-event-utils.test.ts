import { describe, expect, test } from "vitest";
import {
  customerEventType,
  firstTag,
  monotonicMessageStatus,
  normalizeSesEventType,
  statusForSesEvent,
} from "@/workers/ses-event-utils";

describe("SES event reconciliation", () => {
  test("normalizes both SES detail values and EventBridge detail types", () => {
    expect(normalizeSesEventType("Delivery", "Email Delivered")).toBe("DELIVERY");
    expect(normalizeSesEventType(undefined, "Email Complaint Received")).toBe(
      "COMPLAINT",
    );
    expect(normalizeSesEventType("DeliveryDelay")).toBe("DELIVERY_DELAY");
  });

  test("maps lifecycle and customer webhook event names", () => {
    expect(statusForSesEvent("BOUNCE")).toBe("hard_bounced");
    expect(statusForSesEvent("OPEN")).toBeUndefined();
    expect(customerEventType("DELIVERY_DELAY")).toBe("delivery_delayed");
  });

  test("never regresses a terminal message status", () => {
    expect(monotonicMessageStatus("delivered", "sent")).toBe("delivered");
    expect(monotonicMessageStatus("hard_bounced", "delivered")).toBe(
      "hard_bounced",
    );
    expect(monotonicMessageStatus("delivered", "complained")).toBe(
      "complained",
    );
  });

  test("extracts only a non-empty first technical tag", () => {
    expect(firstTag({ ym_message_id: ["message-1"] }, "ym_message_id")).toBe(
      "message-1",
    );
    expect(firstTag({ ym_message_id: [] }, "ym_message_id")).toBeUndefined();
  });
});
