import type Stripe from "stripe";

export const stripeCatalogManifest = {
  currency: "eur",
  platform: {
    lookupKey: "yodev_mail_platform_monthly_v2",
    monthlyAmountMinor: 2900,
  },
  usage: {
    lookupKey: "yodev_mail_usage_v2",
    amountMinorDecimal: "0.25",
    amountEuros: 0.0025,
  },
  meterEventName: "yodev_mail_emails_sent",
  productMetadata: { yodev_product: "mail" },
} as const;

export function stripeSecretLivemode(secret: string) {
  if (/^(?:sk|rk)_live_/.test(secret)) return true;
  if (/^(?:sk|rk)_test_/.test(secret)) return false;
  throw new Error("Stripe secret key mode is not recognizable.");
}

export function validateStripeCatalog(input: {
  platform: Stripe.Price;
  usage: Stripe.Price;
  expectedLivemode?: boolean;
}) {
  const errors: string[] = [];
  const { platform, usage } = input;
  if (!platform.active) errors.push("platform_inactive");
  if (platform.currency !== stripeCatalogManifest.currency) errors.push("platform_currency_invalid");
  if (platform.lookup_key !== stripeCatalogManifest.platform.lookupKey) errors.push("platform_lookup_key_invalid");
  if (platform.unit_amount !== stripeCatalogManifest.platform.monthlyAmountMinor) errors.push("platform_amount_invalid");
  if (platform.recurring?.interval !== "month" || platform.recurring.usage_type === "metered") errors.push("platform_recurring_invalid");
  if (platform.tax_behavior !== "exclusive") errors.push("platform_tax_behavior_invalid");
  if (platform.metadata.yodev_product !== "mail" || platform.metadata.component !== "platform") errors.push("platform_metadata_invalid");

  if (!usage.active) errors.push("usage_inactive");
  if (usage.currency !== stripeCatalogManifest.currency) errors.push("usage_currency_invalid");
  if (usage.lookup_key !== stripeCatalogManifest.usage.lookupKey) errors.push("usage_lookup_key_invalid");
  if (Number(usage.unit_amount_decimal) !== Number(stripeCatalogManifest.usage.amountMinorDecimal)) errors.push("usage_amount_invalid");
  if (usage.recurring?.interval !== "month" || usage.recurring.usage_type !== "metered") errors.push("usage_recurring_invalid");
  if (!usage.recurring?.meter) errors.push("usage_meter_missing");
  if (usage.tax_behavior !== "exclusive") errors.push("usage_tax_behavior_invalid");
  if (usage.metadata.yodev_product !== "mail" || usage.metadata.component !== "usage") errors.push("usage_metadata_invalid");
  const platformProduct = typeof platform.product === "string" ? platform.product : platform.product.id;
  const usageProduct = typeof usage.product === "string" ? usage.product : usage.product.id;
  if (platformProduct !== usageProduct) errors.push("catalog_product_mismatch");
  if (platform.livemode !== usage.livemode) errors.push("catalog_mode_mismatch");
  if (input.expectedLivemode !== undefined && platform.livemode !== input.expectedLivemode) errors.push("catalog_secret_mode_mismatch");
  return errors;
}
