export const planCatalog = {
  starter: {
    name: "Starter",
    monthlyPriceCents: 1900,
    includedEmails: 20_000,
    domains: 2,
    members: 3,
    overageCentsPerThousand: 80,
    dailyLimit: 5_000,
    priceEnv: "STRIPE_PRICE_STARTER",
  },
  pro: {
    name: "Pro",
    monthlyPriceCents: 4900,
    includedEmails: 100_000,
    domains: 10,
    members: 10,
    overageCentsPerThousand: 60,
    dailyLimit: 25_000,
    priceEnv: "STRIPE_PRICE_PRO",
  },
  agency: {
    name: "Agence",
    monthlyPriceCents: 14_900,
    includedEmails: 500_000,
    domains: 50,
    members: 25,
    overageCentsPerThousand: 40,
    dailyLimit: 100_000,
    priceEnv: "STRIPE_PRICE_AGENCY",
  },
} as const;

export type PaidPlan = keyof typeof planCatalog;

export function isPaidPlan(value: string): value is PaidPlan {
  return value in planCatalog;
}

