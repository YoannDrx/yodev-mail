import { describe, expect, it } from "vitest";
import { evaluateSendingEligibility, shouldAutoPause } from "./policy";

const base = {
  stream: "marketing" as const,
  workspaceStatus: "approved" as const,
  billingStatus: "active" as const,
  domainVerified: true,
  suppressed: false,
  marketingConsent: true,
  dailySent: 10,
  dailyLimit: 500,
};

describe("sending policy", () => {
  it("allows a compliant marketing send", () => {
    expect(evaluateSendingEligibility(base)).toEqual({ allowed: true });
  });

  it("never upgrades missing consent", () => {
    expect(evaluateSendingEligibility({ ...base, marketingConsent: false })).toMatchObject({ allowed: false, code: "consent_required" });
  });

  it("blocks all suppressed recipients", () => {
    expect(evaluateSendingEligibility({ ...base, suppressed: true })).toMatchObject({ allowed: false, code: "recipient_suppressed" });
  });

  it("allows transactional grace during past due", () => {
    expect(evaluateSendingEligibility({
      ...base,
      stream: "transactional",
      billingStatus: "past_due",
      graceEndsAt: new Date(Date.now() + 60_000),
    })).toEqual({ allowed: true });
  });

  it("pauses at the reputation thresholds", () => {
    expect(shouldAutoPause({ sent: 1_000, hardBounces: 50, complaints: 0 })).toBe(true);
    expect(shouldAutoPause({ sent: 1_000, hardBounces: 0, complaints: 2 })).toBe(true);
  });
});

