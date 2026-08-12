export const planCatalog = {
  beta: {
    name: "Bêta privée",
    monthlyPriceCents: 2900,
    includedEmails: 0,
    domains: 2,
    members: 3,
    usageEurosPerEmail: 0.0025,
    dailyLimit: 50,
    priceEnv: "STRIPE_PRICE_PLATFORM",
  },
} as const;

export type PaidPlan = keyof typeof planCatalog;

export function isPaidPlan(value: string): value is PaidPlan {
  return value in planCatalog;
}
