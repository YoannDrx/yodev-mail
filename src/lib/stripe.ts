import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";
let client: Stripe | undefined;
export function stripe() {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  return client ??= new Stripe(env.STRIPE_SECRET_KEY);
}
