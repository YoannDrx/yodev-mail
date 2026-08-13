import { describe, expect, it } from "vitest";
import { evaluateSendingEligibility, shouldAutoPause } from "./policy";

const base = {
  workspaceStatus: "approved" as const,
  billingStatus: "active" as const,
  domainVerified: true,
  suppressed: false,
  dailySent: 10,
  dailyLimit: 500,
};

describe("transactional sending policy", () => {
  it("allows an approved transactional send", () => {
    expect(evaluateSendingEligibility(base)).toEqual({ allowed: true });
  });

  it("blocks every suppressed recipient", () => {
    expect(evaluateSendingEligibility({ ...base, suppressed: true })).toMatchObject({ allowed: false, code: "recipient_suppressed" });
  });

  it("allows a past-due grace period", () => {
    expect(evaluateSendingEligibility({
      ...base,
      billingStatus: "past_due",
      graceEndsAt: new Date(Date.now() + 60_000),
    })).toEqual({ allowed: true });
  });

  it("allows only a non-expired internal pilot entitlement", () => {
    expect(evaluateSendingEligibility({ ...base, billingStatus: "inactive", pilotAccessExpiresAt: new Date(Date.now() + 60_000) })).toEqual({ allowed: true });
    expect(evaluateSendingEligibility({ ...base, billingStatus: "inactive", pilotAccessExpiresAt: new Date(Date.now() - 60_000) })).toMatchObject({ allowed: false, code: "billing_inactive" });
  });

  it("pauses on the first complaint, three bounces, or two percent after fifty sends", () => {
    expect(shouldAutoPause({ sent: 1, hardBounces: 0, complaints: 1 })).toBe(true);
    expect(shouldAutoPause({ sent: 20, hardBounces: 3, complaints: 0 })).toBe(true);
    expect(shouldAutoPause({ sent: 50, hardBounces: 1, complaints: 0 })).toBe(true);
    expect(shouldAutoPause({ sent: 49, hardBounces: 1, complaints: 0 })).toBe(false);
  });
});
