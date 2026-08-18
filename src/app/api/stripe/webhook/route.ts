import type Stripe from "stripe";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDb } from "@/db";
import { stripeCheckoutAttempts, stripeEvents, subscriptions, workspaces } from "@/db/schema";
import { readBodyText, RequestBodyTooLargeError } from "@/features/api/read-json-body";
import {
  buildStripeSubscriptionSnapshot,
  invoiceSubscriptionId,
  reduceStripeSubscriptionState,
  StripeSubscriptionRejectedError,
} from "@/features/billing/stripe-state";
import { env } from "@/lib/env";
import { planCatalog } from "@/lib/plans";
import { stripe } from "@/lib/stripe";

function eventObject(event: Stripe.Event) {
  return event.data.object as { id?: string; object?: string; customer?: string | { id: string } | null };
}

function eventSubscriptionId(event: Stripe.Event) {
  if (event.type.startsWith("customer.subscription.")) {
    return (event.data.object as Stripe.Subscription).id;
  }
  if (event.type.startsWith("invoice.")) {
    return invoiceSubscriptionId(event.data.object as Stripe.Invoice);
  }
  if (event.type === "checkout.session.completed") {
    const value = (event.data.object as Stripe.Checkout.Session).subscription;
    return typeof value === "string" ? value : value?.id ?? null;
  }
  return null;
}

function eventCustomerId(event: Stripe.Event) {
  const customer = eventObject(event).customer;
  return typeof customer === "string" ? customer : customer?.id ?? null;
}

export async function POST(request: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  }
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(
      await readBodyText(request, 1024 * 1024),
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const db = requireDb();
  const staleClaim = new Date(Date.now() - 5 * 60_000);
  const object = eventObject(event);
  const subscriptionId = eventSubscriptionId(event);
  await db.insert(stripeEvents).values({
    eventId: event.id,
    type: event.type,
    stripeCreatedAt: new Date(event.created * 1000),
    livemode: event.livemode,
    objectType: object.object,
    objectId: object.id,
    customerId: eventCustomerId(event),
    subscriptionId,
  }).onConflictDoNothing();

  const [claimed] = await db.update(stripeEvents).set({
    status: "processing",
    lastErrorCode: null,
    updatedAt: new Date(),
  }).where(and(
    eq(stripeEvents.eventId, event.id),
    or(
      inArray(stripeEvents.status, ["received", "failed"]),
      and(
        eq(stripeEvents.status, "processing"),
        lt(stripeEvents.updatedAt, staleClaim),
      ),
    ),
  )).returning({ eventId: stripeEvents.eventId });
  if (!claimed) return NextResponse.json({ received: true, duplicate: true });

  if (event.type === "checkout.session.expired" && object.id) {
    const sessionId = object.id;
    const session = event.data.object as Stripe.Checkout.Session;
    const workspaceId = z.string().uuid().safeParse(session.metadata?.workspaceId);
    if (!workspaceId.success || session.client_reference_id !== workspaceId.data) {
      await db.update(stripeEvents).set({
        status: "rejected",
        lastErrorCode: "checkout_workspace_invalid",
        processedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(stripeEvents.eventId, event.id));
      return NextResponse.json({ received: true, rejected: true });
    }
    await db.transaction(async (tx) => {
      await tx.update(stripeCheckoutAttempts).set({
        status: "expired",
        updatedAt: new Date(),
      }).where(and(
        eq(stripeCheckoutAttempts.stripeSessionId, sessionId),
        eq(stripeCheckoutAttempts.workspaceId, workspaceId.data),
        eq(stripeCheckoutAttempts.status, "pending"),
      ));
      await tx.update(stripeEvents).set({
        status: "processed",
        processedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(stripeEvents.eventId, event.id));
    });
    return NextResponse.json({ received: true });
  }

  if (!subscriptionId) {
    await db.update(stripeEvents).set({ status: "ignored", processedAt: new Date(), updatedAt: new Date() })
      .where(eq(stripeEvents.eventId, event.id));
    return NextResponse.json({ received: true, ignored: true });
  }
  if (!env.STRIPE_PRICE_PLATFORM || !env.STRIPE_PRICE_USAGE) {
    await db.update(stripeEvents).set({ status: "failed", lastErrorCode: "catalog_not_configured", updatedAt: new Date() })
      .where(eq(stripeEvents.eventId, event.id));
    return NextResponse.json({ error: "Stripe catalog is not configured" }, { status: 503 });
  }

  try {
    const stripeSubscription = await stripe().subscriptions.retrieve(subscriptionId);
    const snapshot = buildStripeSubscriptionSnapshot({
      eventCreated: event.created,
      eventId: event.id,
      expectedPlatformPriceId: env.STRIPE_PRICE_PLATFORM,
      expectedUsagePriceId: env.STRIPE_PRICE_USAGE,
      expectedLivemode: event.livemode,
      subscription: stripeSubscription,
    });

    await db.transaction(async (tx) => {
      await tx.execute(sql`select ${subscriptions.id} from ${subscriptions} where ${subscriptions.workspaceId} = ${snapshot.workspaceId} for update`);
      const [current] = await tx.select().from(subscriptions)
        .where(eq(subscriptions.workspaceId, snapshot.workspaceId)).limit(1);
      if (!current) throw new StripeSubscriptionRejectedError("subscription_record_missing");
      const result = reduceStripeSubscriptionState({
        status: current.status,
        stripeSubscriptionId: current.stripeSubscriptionId,
        lastStripeEventCreatedAt: current.lastStripeEventCreatedAt,
        lastStripeEventId: current.lastStripeEventId,
        graceEndsAt: current.graceEndsAt,
        canceledAt: current.canceledAt,
      }, snapshot);

      if (result.applied) {
        await tx.update(subscriptions).set({
          ...result.subscription,
          lastReconciledAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(subscriptions.workspaceId, snapshot.workspaceId));
        await tx.update(workspaces).set({
          dailyLimit: planCatalog[snapshot.plan].dailyLimit,
          plan: snapshot.plan,
          updatedAt: new Date(),
        }).where(eq(workspaces.id, snapshot.workspaceId));
        if (result.workspaceAction === "pause_for_billing") {
          await tx.update(workspaces).set({
            pauseReason: "billing",
            pausedAt: new Date(),
            status: "paused",
            updatedAt: new Date(),
          }).where(eq(workspaces.id, snapshot.workspaceId));
        }
        if (result.workspaceAction === "restore_if_billing_paused") {
          await tx.update(workspaces).set({
            pauseReason: null,
            pausedAt: null,
            status: "approved",
            updatedAt: new Date(),
          }).where(and(
            eq(workspaces.id, snapshot.workspaceId),
            eq(workspaces.pauseReason, "billing"),
          ));
        }
      }
      await tx.update(stripeEvents).set({
        customerId: snapshot.customerId,
        subscriptionId: snapshot.subscriptionId,
        status: result.applied ? "processed" : "ignored",
        processedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(stripeEvents.eventId, event.id));
      if (event.type === "checkout.session.completed" && object.id) {
        await tx.update(stripeCheckoutAttempts).set({
          status: "completed",
          completedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(stripeCheckoutAttempts.stripeSessionId, object.id),
          eq(stripeCheckoutAttempts.workspaceId, snapshot.workspaceId),
        ));
      }
    });
  } catch (error) {
    const rejected = error instanceof StripeSubscriptionRejectedError;
    await db.update(stripeEvents).set({
      status: rejected ? "rejected" : "failed",
      lastErrorCode: rejected ? error.code : "stripe_reconciliation_failed",
      processedAt: rejected ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(stripeEvents.eventId, event.id));
    if (rejected) return NextResponse.json({ received: true, rejected: true });
    throw error;
  }

  return NextResponse.json({ received: true });
}
