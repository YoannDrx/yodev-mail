import type Stripe from "stripe";
import { z } from "zod";
import { isPaidPlan, type PaidPlan } from "@/lib/plans";

export type LocalBillingStatus = "inactive" | "trialing" | "active" | "past_due" | "canceled";

export const stripeMeterableSubscriptionStatuses = [
  "active",
  "trialing",
  "past_due",
] as const satisfies readonly LocalBillingStatus[];

export class StripeSubscriptionRejectedError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "StripeSubscriptionRejectedError";
  }
}

export type StripeSubscriptionSnapshot = {
  eventCreatedAt: Date;
  eventId: string;
  customerId: string;
  subscriptionId: string;
  workspaceId: string;
  plan: PaidPlan;
  status: LocalBillingStatus;
  platformPriceId: string;
  currentPeriodStartsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  canceledAt: Date | null;
};

export type CurrentBillingState = {
  status: LocalBillingStatus;
  stripeSubscriptionId: string | null;
  lastStripeEventCreatedAt: Date | null;
  lastStripeEventId: string | null;
  graceEndsAt: Date | null;
  canceledAt: Date | null;
};

function customerId(subscription: Stripe.Subscription) {
  return typeof subscription.customer === "string"
    ? subscription.customer
    : subscription.customer.id;
}

function internalStatus(status: Stripe.Subscription.Status): LocalBillingStatus {
  if (status === "active" || status === "trialing" || status === "past_due" || status === "canceled") {
    return status;
  }
  return "inactive";
}

export function buildStripeSubscriptionSnapshot(input: {
  eventCreated: number;
  eventId: string;
  expectedPlatformPriceId: string;
  expectedUsagePriceId: string;
  expectedLivemode?: boolean;
  subscription: Stripe.Subscription;
}): StripeSubscriptionSnapshot {
  const { subscription } = input;
  if (input.expectedLivemode !== undefined && subscription.livemode !== input.expectedLivemode) {
    throw new StripeSubscriptionRejectedError("subscription_mode_invalid");
  }
  const workspaceId = z.string().uuid().safeParse(subscription.metadata.workspaceId);
  if (!workspaceId.success) throw new StripeSubscriptionRejectedError("workspace_metadata_invalid");
  const requestedPlan = subscription.metadata.plan ?? "";
  if (!isPaidPlan(requestedPlan)) throw new StripeSubscriptionRejectedError("plan_metadata_invalid");
  if (subscription.metadata.yodev_product !== "mail") {
    throw new StripeSubscriptionRejectedError("product_metadata_invalid");
  }

  const prices = new Map(
    subscription.items.data.map((item) => [item.price.id, item] as const),
  );
  if (!prices.has(input.expectedPlatformPriceId) || !prices.has(input.expectedUsagePriceId)) {
    throw new StripeSubscriptionRejectedError("subscription_prices_invalid");
  }
  if (prices.size !== 2) throw new StripeSubscriptionRejectedError("subscription_items_invalid");
  const platform = prices.get(input.expectedPlatformPriceId)!;
  const usage = prices.get(input.expectedUsagePriceId)!;
  if ((platform.quantity ?? 1) !== 1 || platform.price.recurring?.usage_type === "metered") {
    throw new StripeSubscriptionRejectedError("platform_price_invalid");
  }
  if (usage.price.recurring?.usage_type !== "metered") {
    throw new StripeSubscriptionRejectedError("usage_price_invalid");
  }

  const starts = subscription.items.data.map((item) => item.current_period_start).filter(Boolean);
  const ends = subscription.items.data.map((item) => item.current_period_end).filter(Boolean);
  return {
    eventCreatedAt: new Date(input.eventCreated * 1000),
    eventId: input.eventId,
    customerId: customerId(subscription),
    subscriptionId: subscription.id,
    workspaceId: workspaceId.data,
    plan: requestedPlan,
    status: internalStatus(subscription.status),
    platformPriceId: input.expectedPlatformPriceId,
    currentPeriodStartsAt: starts.length ? new Date(Math.min(...starts) * 1000) : null,
    currentPeriodEndsAt: ends.length ? new Date(Math.max(...ends) * 1000) : null,
    canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
  };
}

export function reduceStripeSubscriptionState(
  current: CurrentBillingState,
  snapshot: StripeSubscriptionSnapshot,
) {
  if (
    current.lastStripeEventCreatedAt &&
    snapshot.eventCreatedAt < current.lastStripeEventCreatedAt
  ) {
    return { applied: false as const, reason: "stale_event" as const };
  }
  if (
    current.stripeSubscriptionId === snapshot.subscriptionId &&
    current.status === "canceled" &&
    snapshot.status !== "canceled"
  ) {
    return { applied: false as const, reason: "canceled_subscription_is_terminal" as const };
  }
  if (
    current.stripeSubscriptionId &&
    current.stripeSubscriptionId !== snapshot.subscriptionId &&
    !["inactive", "canceled"].includes(current.status)
  ) {
    throw new StripeSubscriptionRejectedError("active_subscription_replacement_forbidden");
  }

  const enteringPastDue = snapshot.status === "past_due" && current.status !== "past_due";
  const graceEndsAt = snapshot.status === "past_due"
    ? enteringPastDue || !current.graceEndsAt
      ? new Date(snapshot.eventCreatedAt.getTime() + 72 * 3600_000)
      : current.graceEndsAt
    : null;

  return {
    applied: true as const,
    subscription: {
      canceledAt: snapshot.status === "canceled"
        ? snapshot.canceledAt ?? current.canceledAt ?? snapshot.eventCreatedAt
        : null,
      currentPeriodEndsAt: snapshot.currentPeriodEndsAt,
      currentPeriodStartsAt: snapshot.currentPeriodStartsAt,
      graceEndsAt,
      lastStripeEventCreatedAt: snapshot.eventCreatedAt,
      lastStripeEventId: snapshot.eventId,
      plan: snapshot.plan,
      status: snapshot.status,
      stripeCustomerId: snapshot.customerId,
      stripePriceId: snapshot.platformPriceId,
      stripeSubscriptionId: snapshot.subscriptionId,
    },
    workspaceAction:
      snapshot.status === "active" || snapshot.status === "trialing"
        ? "restore_if_billing_paused"
        : snapshot.status === "canceled"
          ? "pause_for_billing"
          : "none",
  };
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice) {
  const subscription = invoice.parent?.subscription_details?.subscription;
  return typeof subscription === "string" ? subscription : subscription?.id ?? null;
}
