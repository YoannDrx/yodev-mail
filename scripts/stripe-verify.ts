import Stripe from "stripe";

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing");
  const stripe = new Stripe(secret);
  const prices = await stripe.prices.list({ active: true, limit: 100 });
  const platform = prices.data.find((price) => price.lookup_key === "yodev_mail_platform_monthly_v1");
  const usage = prices.data.find((price) => price.lookup_key === "yodev_mail_usage_v1");
  if (platform?.unit_amount !== 2900 || platform.recurring?.interval !== "month") throw new Error("Invalid platform price");
  if (String(usage?.unit_amount_decimal) !== "0.0025" || usage?.recurring?.usage_type !== "metered") throw new Error("Invalid usage price");
  console.log("Stripe beta catalog valid: €29/month + €0.0025 per accepted email");
}

void main();
