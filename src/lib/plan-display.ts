import type { Locale } from "@/i18n/config";
import { warmupLimitForStage } from "@/features/sending/warmup";
import { planCatalog } from "@/lib/plans";

function euros(locale: Locale, amount: number, fractionDigits: number) {
  return new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(amount);
}

function fractionDigitsOf(amount: number) {
  return Number.isInteger(amount) ? 0 : 2;
}

/** Display values for the beta plan, always derived from `src/lib/plans.ts`. */
export function betaPlanDisplay(locale: Locale) {
  const plan = planCatalog.beta;
  const monthly = plan.monthlyPriceCents / 100;
  const perThousand = Math.round(plan.usageEurosPerEmail * 1000 * 100) / 100;
  const perEmailDigits = Math.max(2, (String(plan.usageEurosPerEmail).split(".")[1] ?? "").length);
  return {
    monthly: euros(locale, monthly, fractionDigitsOf(monthly)),
    perEmail: euros(locale, plan.usageEurosPerEmail, perEmailDigits),
    perThousand: euros(locale, perThousand, 2),
    domains: plan.domains,
    members: plan.members,
    // The plan no longer carries a limit: every approved sender starts at warmup stage 1.
    dailyLimit: warmupLimitForStage(1),
  };
}
