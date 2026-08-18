import Stripe from "stripe";
import { stripeSecretLivemode, validateStripeCatalog } from "../src/features/billing/stripe-catalog";

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  const platformPriceId = process.env.STRIPE_PRICE_PLATFORM;
  const usagePriceId = process.env.STRIPE_PRICE_USAGE;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing");
  if (!platformPriceId || !usagePriceId) throw new Error("Configured Stripe price IDs are missing");

  const stripe = new Stripe(secret);
  const [platform, usage, registrations] = await Promise.all([
    stripe.prices.retrieve(platformPriceId),
    stripe.prices.retrieve(usagePriceId),
    stripe.tax.registrations.list({ limit: 1, status: "active" }),
  ]);
  const errors = validateStripeCatalog({
    platform,
    usage,
    expectedLivemode: stripeSecretLivemode(secret),
  });
  if (usage.recurring?.meter) {
    const meter = await stripe.billing.meters.retrieve(usage.recurring.meter);
    if (meter.event_name !== "yodev_mail_emails_sent") errors.push("usage_meter_event_invalid");
  }
  if (!registrations.data.length) errors.push("active_tax_registration_missing");
  if (errors.length) throw new Error(`Invalid Stripe beta catalog: ${errors.join(",")}`);
  console.log(`Stripe beta catalog valid (${platform.livemode ? "live" : "test"}): EUR 29/month + EUR 0.0025 per accepted email`);
}

void main();
