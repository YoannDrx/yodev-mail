import { describe, expect, it } from "vitest";
import { evaluateSendingEligibility, reputationPolicy, shouldAutoPause } from "./policy";

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

  it("protects a brand-new sender with absolute floors at 50 sends", () => {
    expect(shouldAutoPause({ sent: 50, hardBounces: 2, complaints: 0 })).toBe(false);
    expect(shouldAutoPause({ sent: 50, hardBounces: 3, complaints: 0 })).toBe(true);
    expect(shouldAutoPause({ sent: 50, hardBounces: 0, complaints: 1 })).toBe(true);
    expect(shouldAutoPause({ sent: 1, hardBounces: 0, complaints: 1 })).toBe(true);
    expect(shouldAutoPause({ sent: 0, hardBounces: 0, complaints: 0 })).toBe(false);
  });

  it("uses a 2% hard-bounce rate and the 0.1% complaint rate at 500 sends", () => {
    expect(shouldAutoPause({ sent: 500, hardBounces: 3, complaints: 0 })).toBe(false);
    expect(shouldAutoPause({ sent: 500, hardBounces: 9, complaints: 0 })).toBe(false);
    expect(shouldAutoPause({ sent: 500, hardBounces: 10, complaints: 0 })).toBe(true);
    // One complaint in 500 is 0.2%, above the 0.1% expectation.
    expect(shouldAutoPause({ sent: 500, hardBounces: 0, complaints: 1 })).toBe(true);
  });

  it("no longer pauses on three hard bounces at 5,000 sends", () => {
    expect(shouldAutoPause({ sent: 5_000, hardBounces: 3, complaints: 0 })).toBe(false);
    expect(shouldAutoPause({ sent: 5_000, hardBounces: 99, complaints: 0 })).toBe(false);
    expect(shouldAutoPause({ sent: 5_000, hardBounces: 100, complaints: 0 })).toBe(true);
    expect(shouldAutoPause({ sent: 5_000, hardBounces: 0, complaints: 4 })).toBe(false);
    expect(shouldAutoPause({ sent: 5_000, hardBounces: 0, complaints: 5 })).toBe(true);
  });

  it("joins the bounce floor and rate continuously at the minimum volume", () => {
    expect(reputationPolicy.hardBounceFloor / reputationPolicy.hardBounceRateMinimumVolume).toBe(reputationPolicy.hardBounceRate);
    expect(shouldAutoPause({ sent: 149, hardBounces: 2, complaints: 0 })).toBe(false);
    expect(shouldAutoPause({ sent: 150, hardBounces: 3, complaints: 0 })).toBe(true);
    expect(shouldAutoPause({ sent: 151, hardBounces: 3, complaints: 0 })).toBe(false);
  });
});
