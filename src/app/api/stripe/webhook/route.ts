import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { stripeEvents, subscriptions, workspaces } from "@/db/schema";
import { env } from "@/lib/env";
import { isPaidPlan, planCatalog } from "@/lib/plans";
import { stripe } from "@/lib/stripe";

function subscriptionStatus(status: Stripe.Subscription.Status) {
  if (status === "active" || status === "trialing" || status === "past_due" || status === "canceled") return status;
  return "inactive" as const;
}

export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await request.text(), signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = requireDb();
  let duplicate = false;
  await db.transaction(async (tx) => {
    const inserted = await tx.insert(stripeEvents).values({ eventId: event.id, type: event.type }).onConflictDoNothing().returning();
    if (!inserted.length) {
      duplicate = true;
      return;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const workspaceId = session.metadata?.workspaceId;
      const requestedPlan = session.metadata?.plan ?? "";
      const paymentConfirmed = session.payment_status === "paid" || session.payment_status === "no_payment_required";
      if (workspaceId && session.client_reference_id === workspaceId && paymentConfirmed && isPaidPlan(requestedPlan) && typeof session.customer === "string" && typeof session.subscription === "string") {
        const plan = requestedPlan;
        await tx.update(subscriptions).set({
          plan,
          status: "active",
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          updatedAt: new Date(),
        }).where(eq(subscriptions.workspaceId, workspaceId));
        await tx.update(workspaces).set({
          dailyLimit: planCatalog[plan].dailyLimit,
          plan,
          updatedAt: new Date(),
        }).where(eq(workspaces.id, workspaceId));
      }
    }

    if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const workspaceId = subscription.metadata.workspaceId;
      const requestedPlan = subscription.metadata.plan ?? "";
      if (workspaceId) {
        const paidPlan = isPaidPlan(requestedPlan) ? requestedPlan : undefined;
        const status = subscriptionStatus(subscription.status);
        const period = subscription.items.data[0];
        await tx.update(subscriptions).set({
          currentPeriodEndsAt: period ? new Date(period.current_period_end * 1000) : null,
          currentPeriodStartsAt: period ? new Date(period.current_period_start * 1000) : null,
          graceEndsAt: status === "past_due" ? new Date(Date.now() + 72 * 3600_000) : null,
          plan: paidPlan,
          status,
          stripePriceId: period?.price.id,
          stripeSubscriptionId: subscription.id,
          updatedAt: new Date(),
        }).where(eq(subscriptions.workspaceId, workspaceId));
        if (paidPlan) {
          await tx.update(workspaces).set({ dailyLimit: planCatalog[paidPlan].dailyLimit, plan: paidPlan, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
        }
        if (status === "canceled") {
          await tx.update(workspaces).set({ pauseReason: "billing", pausedAt: new Date(), status: "paused", updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
        }
      }
    }

    if (event.type === "invoice.payment_failed" || event.type === "invoice.finalization_failed") {
      const invoice = event.data.object;
      if (typeof invoice.customer === "string") {
        await tx.update(subscriptions).set({ graceEndsAt: new Date(Date.now() + 72 * 3600_000), status: "past_due", updatedAt: new Date() }).where(eq(subscriptions.stripeCustomerId, invoice.customer));
      }
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      if (typeof invoice.customer === "string") {
        const [record] = await tx.update(subscriptions).set({ graceEndsAt: null, status: "active", updatedAt: new Date() }).where(eq(subscriptions.stripeCustomerId, invoice.customer)).returning({ workspaceId: subscriptions.workspaceId });
        if (record) {
          await tx.update(workspaces).set({ pauseReason: null, pausedAt: null, status: "approved", updatedAt: new Date() }).where(and(eq(workspaces.id, record.workspaceId), eq(workspaces.pauseReason, "billing")));
        }
      }
    }
  });
  return NextResponse.json({ received: true, duplicate });
}
