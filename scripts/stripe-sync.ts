import Stripe from "stripe";
import { stripeCatalogManifest } from "../src/features/billing/stripe-catalog";

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret?.startsWith("sk_test_")) throw new Error("stripe:sync only accepts a Stripe test secret key");
  const stripe = new Stripe(secret);
  const products = await stripe.products.search({ query: "metadata['yodev_product']:'mail'", limit: 1 });
  const product = products.data[0] ?? await stripe.products.create({
    name: "Mail by Yodev — Accès plateforme",
    description: "Passerelle privée d’emails exclusivement transactionnels pour applications vérifiées.",
    metadata: { yodev_product: "mail" },
  });
  const meters = await stripe.billing.meters.list({ limit: 100 });
  const meter = meters.data.find((item) => item.event_name === "yodev_mail_emails_sent") ?? await stripe.billing.meters.create({
    display_name: "Emails transactionnels acceptés",
    event_name: "yodev_mail_emails_sent",
    default_aggregation: { formula: "sum" },
    customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
    value_settings: { event_payload_key: "value" },
  });
  const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const platform = existing.data.find((price) => price.lookup_key === stripeCatalogManifest.platform.lookupKey) ?? await stripe.prices.create({
    product: product.id,
    currency: "eur",
    unit_amount: 2900,
    recurring: { interval: "month" },
    tax_behavior: "exclusive",
    lookup_key: stripeCatalogManifest.platform.lookupKey,
    nickname: "Accès plateforme — bêta privée",
    metadata: { yodev_product: "mail", component: "platform", domains: "2", members: "3" },
  });
  const usage = existing.data.find((price) => price.lookup_key === stripeCatalogManifest.usage.lookupKey) ?? await stripe.prices.create({
    product: product.id,
    currency: "eur",
    // Stripe decimal amounts are expressed in the currency's minor unit.
    // 0.25 euro cent is €0.0025.
    unit_amount_decimal: Stripe.Decimal.from(stripeCatalogManifest.usage.amountMinorDecimal),
    recurring: { interval: "month", usage_type: "metered", meter: meter.id },
    tax_behavior: "exclusive",
    lookup_key: stripeCatalogManifest.usage.lookupKey,
    nickname: "Email accepté",
    metadata: { yodev_product: "mail", component: "usage" },
  });
  console.log(`platform=${platform.id} usage=${usage.id} product=${product.id} meter=${meter.id}`);
}

void main();
