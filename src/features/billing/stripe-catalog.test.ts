import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import { stripeCatalogManifest, stripeSecretLivemode, validateStripeCatalog } from "@/features/billing/stripe-catalog";

function price(value: Partial<Stripe.Price>): Stripe.Price {
  return {
    active: true,
    currency: "eur",
    livemode: false,
    lookup_key: null,
    metadata: {},
    product: "prod_mail",
    recurring: null,
    tax_behavior: "exclusive",
    unit_amount: null,
    unit_amount_decimal: null,
    ...value,
  } as Stripe.Price;
}

describe("Stripe catalog manifest", () => {
  const platform = price({
    lookup_key: stripeCatalogManifest.platform.lookupKey,
    metadata: { yodev_product: "mail", component: "platform" },
    recurring: { interval: "month", usage_type: "licensed" } as Stripe.Price.Recurring,
    unit_amount: 2900,
    unit_amount_decimal: Stripe.Decimal.from("2900"),
  });
  const usage = price({
    lookup_key: stripeCatalogManifest.usage.lookupKey,
    metadata: { yodev_product: "mail", component: "usage" },
    recurring: { interval: "month", usage_type: "metered", meter: "mtr_mail" } as Stripe.Price.Recurring,
    unit_amount_decimal: Stripe.Decimal.from("0.25"),
  });

  it("accepts €29/month plus €0.0025 per accepted email", () => {
    expect(validateStripeCatalog({ platform, usage })).toEqual([]);
  });

  it("rejects the historical price that was 100 times too low", () => {
    expect(validateStripeCatalog({ platform, usage: { ...usage, unit_amount_decimal: Stripe.Decimal.from("0.0025") } })).toContain("usage_amount_invalid");
  });

  it("rejects test/live mode mixing", () => {
    expect(validateStripeCatalog({ platform, usage: { ...usage, livemode: true } })).toContain("catalog_mode_mismatch");
  });

  it("rejects a catalog from the wrong API-key mode", () => {
    expect(validateStripeCatalog({ platform, usage, expectedLivemode: true })).toContain("catalog_secret_mode_mismatch");
  });

  it("recognizes standard and restricted Stripe key modes", () => {
    expect(stripeSecretLivemode("sk_live_example")).toBe(true);
    expect(stripeSecretLivemode("rk_live_example")).toBe(true);
    expect(stripeSecretLivemode("sk_test_example")).toBe(false);
    expect(stripeSecretLivemode("rk_test_example")).toBe(false);
  });
});
