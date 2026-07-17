import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { stripeEvents, subscriptions, workspaces } from "@/db/schema";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";

export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try { event = stripe().webhooks.constructEvent(await request.text(), signature, env.STRIPE_WEBHOOK_SECRET); }
  catch { return NextResponse.json({ error: "Invalid signature" }, { status: 400 }); }
  const db = requireDb();
  const [seen] = await db.select().from(stripeEvents).where(eq(stripeEvents.eventId, event.id)).limit(1);
  if (seen) return NextResponse.json({ received: true, duplicate: true });
  await db.transaction(async tx => {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const workspaceId = session.metadata?.workspaceId;
      if (workspaceId && typeof session.customer === "string" && typeof session.subscription === "string") await tx.update(subscriptions).set({ stripeCustomerId: session.customer, stripeSubscriptionId: session.subscription, status: "active", updatedAt: new Date() }).where(eq(subscriptions.workspaceId, workspaceId));
    }
    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const workspaceId = subscription.metadata.workspaceId;
      if (workspaceId) {
        const status = subscription.status === "active" || subscription.status === "trialing" ? subscription.status : subscription.status === "past_due" ? "past_due" : subscription.status === "canceled" ? "canceled" : "inactive";
        await tx.update(subscriptions).set({ status, stripeSubscriptionId: subscription.id, graceEndsAt: status === "past_due" ? new Date(Date.now() + 72 * 3600_000) : null, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, workspaceId));
        if (status === "canceled") await tx.update(workspaces).set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
      }
    }
    await tx.insert(stripeEvents).values({ eventId: event.id, type: event.type });
  });
  return NextResponse.json({ received: true });
}
