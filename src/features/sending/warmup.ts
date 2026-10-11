import { shouldAutoPause } from "@/features/sending/policy";

/**
 * Progressive daily limits. Each step requires the waiting time at the current
 * stage and a clean sample of recent days: no complaint and no automatic-pause
 * condition (see reputationPolicy). From 500/day upward a workspace must also
 * have actually used its current limit, so an idle sender never unlocks a
 * volume it has not proven. Operator overrides are set with
 * setWorkspaceDailyLimit and are never changed by the warmup worker.
 */
export const warmupStages = [
  { stage: 1, dailyLimit: 50 },
  { stage: 2, dailyLimit: 200, waitDays: 3, sampleDays: 3, minimumSampleVolume: 0 },
  { stage: 3, dailyLimit: 500, waitDays: 4, sampleDays: 7, minimumSampleVolume: 0 },
  { stage: 4, dailyLimit: 1_000, waitDays: 7, sampleDays: 7, minimumSampleVolume: 500 },
  { stage: 5, dailyLimit: 2_000, waitDays: 7, sampleDays: 7, minimumSampleVolume: 1_000 },
  { stage: 6, dailyLimit: 5_000, waitDays: 14, sampleDays: 14, minimumSampleVolume: 2_000 },
  { stage: 7, dailyLimit: 10_000, waitDays: 14, sampleDays: 14, minimumSampleVolume: 5_000 },
] as const;

export const maxWarmupStage = warmupStages[warmupStages.length - 1].stage;

/** The automatic limit of a stage; stage 0 (not yet approved) gets the first step. */
export function warmupLimitForStage(stage: number) {
  const step = warmupStages.find((candidate) => candidate.stage === stage);
  if (step) return step.dailyLimit;
  return stage > maxWarmupStage ? warmupStages[warmupStages.length - 1].dailyLimit : warmupStages[0].dailyLimit;
}

export function nextWarmupStep(stage: number) {
  const next = warmupStages.find((candidate) => candidate.stage === stage + 1);
  return next && "waitDays" in next ? next : null;
}

export type WarmupSample = { accepted: number; complaints: number; hardBounces: number };

export function warmupDecision(input: {
  stage: number;
  reference: Date | null;
  sample: WarmupSample;
  now?: Date;
}): { advance: false; reason: string } | { advance: true; toStage: number; dailyLimit: number } {
  const next = nextWarmupStep(input.stage);
  if (!next) return { advance: false, reason: "final_stage" };
  const now = input.now ?? new Date();
  if (!input.reference || input.reference > new Date(now.getTime() - next.waitDays * 864e5)) {
    return { advance: false, reason: "waiting" };
  }
  const { sample } = input;
  if (sample.complaints > 0 || shouldAutoPause({ sent: sample.accepted, hardBounces: sample.hardBounces, complaints: sample.complaints })) {
    return { advance: false, reason: "unhealthy" };
  }
  if (sample.accepted < next.minimumSampleVolume) return { advance: false, reason: "insufficient_volume" };
  return { advance: true, toStage: next.stage, dailyLimit: next.dailyLimit };
}
