import Stripe from "stripe";
async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing");
  const stripe = new Stripe(secret);
  const prices = await stripe.prices.list({ active: true, limit: 100 });
  for (const plan of ["starter", "pro", "agency"]) {
    const parts = prices.data.filter(price => price.metadata.plan === plan);
    if (!parts.some(price => price.metadata.component === "base") || !parts.some(price => price.metadata.component === "overage")) throw new Error(`Incomplete prices for ${plan}`);
  }
  console.log("Stripe catalog valid: fixed and overage prices found for all plans");
}

void main();
