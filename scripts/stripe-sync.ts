import Stripe from "stripe";
import { planCatalog } from "../src/lib/plans";

const secret = process.env.STRIPE_SECRET_KEY;
if (!secret?.startsWith("sk_test_")) throw new Error("stripe:sync only accepts a Stripe test secret key");
const stripe = new Stripe(secret);
const products = await stripe.products.search({ query: "metadata['vigiemail']='true'", limit: 1 });
const product = products.data[0] ?? await stripe.products.create({ name: "VigieMail", description: "Emails marketing et transactionnels propulsés par Amazon SES", metadata: { vigiemail: "true" }, tax_code: "txcd_10103000" });
const meters = await stripe.billing.meters.list({ limit: 100 });
const meter = meters.data.find(item => item.event_name === "vigiemail_emails_sent") ?? await stripe.billing.meters.create({ display_name: "Emails VigieMail acceptés par SES", event_name: "vigiemail_emails_sent", default_aggregation: { formula: "sum" }, customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" }, value_settings: { event_payload_key: "value" } });
const existing = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
for (const [id, plan] of Object.entries(planCatalog)) {
  const fixedKey = `vigiemail_${id}_monthly_v1`;
  const overageKey = `vigiemail_${id}_overage_v1`;
  const fixed = existing.data.find(price => price.lookup_key === fixedKey) ?? await stripe.prices.create({ product: product.id, currency: "eur", unit_amount: plan.monthlyPriceCents, recurring: { interval: "month" }, tax_behavior: "exclusive", lookup_key: fixedKey, nickname: `${plan.name} mensuel`, metadata: { plan: id, component: "base" } });
  const overage = existing.data.find(price => price.lookup_key === overageKey) ?? await stripe.prices.create({ product: product.id, currency: "eur", unit_amount_decimal: Stripe.Decimal.from(plan.overageCentsPerThousand / 1000), recurring: { interval: "month", usage_type: "metered", meter: meter.id }, tax_behavior: "exclusive", lookup_key: overageKey, nickname: `${plan.name} dépassement par email`, metadata: { plan: id, component: "overage", included_emails: String(plan.includedEmails) } });
  console.log(`${plan.name}: fixed=${fixed.id} overage=${overage.id}`);
}
console.log(`product=${product.id} meter=${meter.id}`);
