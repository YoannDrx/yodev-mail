export type SendingEligibilityInput = {
  mode?: "test" | "live";
  workspaceStatus: "sandbox" | "pending_review" | "approved" | "paused" | "rejected";
  billingStatus: "inactive" | "trialing" | "active" | "past_due" | "canceled";
  domainVerified: boolean;
  suppressed: boolean;
  dailySent: number;
  dailyLimit: number;
  now?: Date;
  graceEndsAt?: Date | null;
  pilotAccessExpiresAt?: Date | null;
};

export type EligibilityResult = { allowed: true } | { allowed: false; code: string; reason: string };

export function evaluateSendingEligibility(input: SendingEligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  const mode = input.mode ?? "live";
  if (mode === "live" && input.workspaceStatus !== "approved") {
    return { allowed: false, code: "workspace_not_approved", reason: "Le workspace doit être approuvé avant un envoi public." };
  }
  if (mode === "test" && (input.workspaceStatus === "paused" || input.workspaceStatus === "rejected")) {
    return { allowed: false, code: "workspace_not_available", reason: "Le workspace est suspendu ou refusé." };
  }
  if (!input.domainVerified) {
    return { allowed: false, code: "domain_not_verified", reason: "Le domaine expéditeur n’est pas vérifié." };
  }
  if (input.suppressed) {
    return { allowed: false, code: "recipient_suppressed", reason: "Cette adresse est présente dans la liste de suppression." };
  }
  if (input.dailySent >= input.dailyLimit) {
    return { allowed: false, code: "daily_limit_reached", reason: "Le quota quotidien progressif est atteint." };
  }
  if (mode === "test") return { allowed: true };
  if (input.pilotAccessExpiresAt && input.pilotAccessExpiresAt > now) return { allowed: true };
  if (input.billingStatus === "active" || input.billingStatus === "trialing") return { allowed: true };
  if (
    input.billingStatus === "past_due" &&
    input.graceEndsAt &&
    input.graceEndsAt > now
  ) {
    return { allowed: true };
  }
  return { allowed: false, code: "billing_inactive", reason: "Un abonnement actif est requis." };
}

/**
 * Automatic suspension thresholds, evaluated on the workspace's last 7 days
 * (accepted emails, hard bounces and complaints from usage_days).
 *
 * Reference: Postmark reviews senders above a 10% bounce rate and expects spam
 * complaints below 0.1%. Yodev pauses much earlier on bounces (2%) and at
 * Postmark's complaint rate. A rate is meaningless on a handful of sends, so
 * below a minimum volume an absolute floor protects brand-new senders: 3 hard
 * bounces, or a single complaint (which already exceeds 0.1% under 1,000
 * sends). The bounce floor and rate meet at 150 sends (3 / 150 = 2%).
 */
export const reputationPolicy = {
  windowDays: 7,
  hardBounceRate: 0.02,
  hardBounceRateMinimumVolume: 150,
  hardBounceFloor: 3,
  complaintRate: 0.001,
  complaintRateMinimumVolume: 1_000,
  complaintFloor: 1,
} as const;

export function shouldAutoPause({ sent, hardBounces, complaints }: { sent: number; hardBounces: number; complaints: number }) {
  const policy = reputationPolicy;
  if (complaints >= policy.complaintFloor
    && (sent < policy.complaintRateMinimumVolume || complaints / sent >= policy.complaintRate)) return true;
  if (sent < policy.hardBounceRateMinimumVolume) return hardBounces >= policy.hardBounceFloor;
  return hardBounces / sent >= policy.hardBounceRate;
}
