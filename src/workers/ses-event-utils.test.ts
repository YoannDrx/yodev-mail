import { describe, expect, test } from "vitest";
import { monotonicMessageStatus } from "@/workers/ses-event-utils";

describe("SES event reconciliation", () => {
  test("never regresses a terminal message status", () => {
    expect(monotonicMessageStatus("delivered", "sent")).toBe("delivered");
    expect(monotonicMessageStatus("hard_bounced", "delivered")).toBe(
      "hard_bounced",
    );
    expect(monotonicMessageStatus("delivered", "complained")).toBe(
      "complained",
    );
  });
});
