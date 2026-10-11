import { describe, expect, it } from "vitest";
import { maxWarmupStage, warmupDecision, warmupLimitForStage, warmupStages } from "./warmup";

const daysAgo = (days: number) => new Date(Date.now() - days * 864e5);
const clean = (accepted: number) => ({ accepted, complaints: 0, hardBounces: 0 });

describe("warmup tiers", () => {
  it("keeps the historical first three steps and adds higher tiers", () => {
    expect(warmupStages.map((step) => step.dailyLimit)).toEqual([50, 200, 500, 1_000, 2_000, 5_000, 10_000]);
    expect(warmupLimitForStage(0)).toBe(50);
    expect(warmupLimitForStage(3)).toBe(500);
    expect(warmupLimitForStage(maxWarmupStage)).toBe(10_000);
    expect(warmupLimitForStage(99)).toBe(10_000);
  });

  it("advances stage 1 and 2 on time and health alone, as before", () => {
    expect(warmupDecision({ stage: 1, reference: daysAgo(3.1), sample: clean(0) })).toEqual({ advance: true, toStage: 2, dailyLimit: 200 });
    expect(warmupDecision({ stage: 1, reference: daysAgo(2), sample: clean(100) })).toMatchObject({ advance: false, reason: "waiting" });
    expect(warmupDecision({ stage: 2, reference: daysAgo(5), sample: clean(500) })).toEqual({ advance: true, toStage: 3, dailyLimit: 500 });
  });

  it("goes above 500 per day only for a healthy sender that used its limit", () => {
    expect(warmupDecision({ stage: 3, reference: daysAgo(8), sample: clean(499) })).toMatchObject({ advance: false, reason: "insufficient_volume" });
    expect(warmupDecision({ stage: 3, reference: daysAgo(8), sample: clean(500) })).toEqual({ advance: true, toStage: 4, dailyLimit: 1_000 });
    expect(warmupDecision({ stage: 6, reference: daysAgo(15), sample: clean(5_000) })).toEqual({ advance: true, toStage: 7, dailyLimit: 10_000 });
    expect(warmupDecision({ stage: 7, reference: daysAgo(90), sample: clean(50_000) })).toMatchObject({ advance: false, reason: "final_stage" });
  });

  it("applies the same health criteria at every tier", () => {
    for (const stage of [1, 2, 3, 4, 5, 6]) {
      expect(warmupDecision({ stage, reference: daysAgo(30), sample: { accepted: 10_000, complaints: 1, hardBounces: 0 } }))
        .toMatchObject({ advance: false, reason: "unhealthy" });
      expect(warmupDecision({ stage, reference: daysAgo(30), sample: { accepted: 10_000, complaints: 0, hardBounces: 200 } }))
        .toMatchObject({ advance: false, reason: "unhealthy" });
    }
  });
});
