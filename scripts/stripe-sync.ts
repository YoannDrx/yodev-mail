import Stripe from "stripe";
import { stripeCatalogManifest, validateStripeCatalog } from "../src/features/billing/stripe-catalog";

const productDefinition = {
  name: "Mail by Yodev — Accès plateforme",
  description: "Passerelle API française pour l’envoi, le suivi et la sécurisation d’e-mails transactionnels.",
  statementDescriptor: "MAIL BY YODEV",
  url: "https://mail.yodev.fr",
  marketingFeatures: [
    "API transactionnelle multi-projet",
    "Domaines, modèles et événements de livraison",
    "Quotas, suppressions et isolation par workspace",
  ],
} as const;

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !/^(?:sk|rk)_test_/.test(secret)) {
    throw new Error("stripe:sync only accepts a Stripe test secret or restricted key");
  }
  const stripe = new Stripe(secret);
  const products = await stripe.products.search({ query: "metadata['yodev_product']:'mail'", limit: 1 });
  const existingProduct = products.data[0];
  const productInput = {
    name: productDefinition.name,
    description: productDefinition.description,
    statement_descriptor: productDefinition.statementDescriptor,
    url: productDefinition.url,
    marketing_features: productDefinition.marketingFeatures.map((name) => ({ name })),
    metadata: stripeCatalogManifest.productMetadata,
  } satisfies Stripe.ProductCreateParams;
  const product = existingProduct
    ? await stripe.products.update(existingProduct.id, productInput)
    : await stripe.products.create(productInput);
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
  const validationErrors = validateStripeCatalog({ platform, usage, expectedLivemode: false });
  if (validationErrors.length) {
    throw new Error(`Stripe catalog validation failed: ${validationErrors.join(", ")}`);
  }
  if (product.default_price !== platform.id) {
    await stripe.products.update(product.id, { default_price: platform.id });
  }
  console.log(`platform=${platform.id} usage=${usage.id} product=${product.id} meter=${meter.id}`);
}

void main();
