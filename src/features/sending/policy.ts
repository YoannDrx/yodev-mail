export type SendingEligibilityInput = {
  stream: "transactional" | "marketing";
  workspaceStatus: "sandbox" | "pending_review" | "approved" | "paused" | "rejected";
  billingStatus: "inactive" | "trialing" | "active" | "past_due" | "canceled";
  domainVerified: boolean;
  suppressed: boolean;
  marketingConsent?: boolean;
  dailySent: number;
  dailyLimit: number;
  now?: Date;
  graceEndsAt?: Date | null;
};

export type EligibilityResult = { allowed: true } | { allowed: false; code: string; reason: string };

export function evaluateSendingEligibility(input: SendingEligibilityInput): EligibilityResult {
  const now = input.now ?? new Date();
  if (input.workspaceStatus !== "approved") {
    return { allowed: false, code: "workspace_not_approved", reason: "Le workspace doit être approuvé avant un envoi public." };
  }
  if (!input.domainVerified) {
    return { allowed: false, code: "domain_not_verified", reason: "Le domaine expéditeur n’est pas vérifié." };
  }
  if (input.suppressed) {
    return { allowed: false, code: "recipient_suppressed", reason: "Cette adresse est présente dans la liste de suppression." };
  }
  if (input.stream === "marketing" && !input.marketingConsent) {
    return { allowed: false, code: "consent_required", reason: "Un consentement marketing ou une base légale documentée est requis." };
  }
  if (input.dailySent >= input.dailyLimit) {
    return { allowed: false, code: "daily_limit_reached", reason: "Le quota quotidien progressif est atteint." };
  }
  if (input.billingStatus === "active" || input.billingStatus === "trialing") return { allowed: true };
  if (
    input.stream === "transactional" &&
    input.billingStatus === "past_due" &&
    input.graceEndsAt &&
    input.graceEndsAt > now
  ) {
    return { allowed: true };
  }
  return { allowed: false, code: "billing_inactive", reason: "Un abonnement actif est requis." };
}

export function shouldAutoPause({ sent, hardBounces, complaints }: { sent: number; hardBounces: number; complaints: number }) {
  if (sent < 100) return false;
  return hardBounces / sent >= 0.05 || complaints / sent >= 0.002;
}

