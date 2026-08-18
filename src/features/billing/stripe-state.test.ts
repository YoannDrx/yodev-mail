import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import {
  buildStripeSubscriptionSnapshot,
  reduceStripeSubscriptionState,
  stripeMeterableSubscriptionStatuses,
  StripeSubscriptionRejectedError,
} from "@/features/billing/stripe-state";

const platformPriceId = "price_platform";
const usagePriceId = "price_usage";

function subscription(overrides: Partial<Stripe.Subscription> = {}) {
  return {
    id: "sub_current",
    object: "subscription",
    canceled_at: null,
    customer: "cus_current",
    metadata: { workspaceId: "11111111-1111-4111-8111-111111111111", plan: "beta", yodev_product: "mail" },
    status: "active",
    items: {
      data: [
        { current_period_start: 100, current_period_end: 200, price: { id: platformPriceId, recurring: { usage_type: "licensed" } }, quantity: 1 },
        { current_period_start: 100, current_period_end: 200, price: { id: usagePriceId, recurring: { usage_type: "metered" } }, quantity: null },
      ],
    },
    ...overrides,
  } as Stripe.Subscription;
}

function snapshot(value = subscription(), eventCreated = 1_000, eventId = "evt_1") {
  return buildStripeSubscriptionSnapshot({
    eventCreated,
    eventId,
    expectedPlatformPriceId: platformPriceId,
    expectedUsagePriceId: usagePriceId,
    subscription: value,
  });
}

const current = {
  status: "inactive" as const,
  stripeSubscriptionId: null,
  lastStripeEventCreatedAt: null,
  lastStripeEventId: null,
  graceEndsAt: null,
  canceledAt: null,
};

describe("Stripe subscription state", () => {
  it("meters every status that can still send, including the past-due grace period", () => {
    expect(stripeMeterableSubscriptionStatuses).toEqual([
      "active",
      "trialing",
      "past_due",
    ]);
    expect(stripeMeterableSubscriptionStatuses).not.toContain("inactive");
    expect(stripeMeterableSubscriptionStatuses).not.toContain("canceled");
  });

  it("requires the exact platform and usage prices", () => {
    expect(() => snapshot(subscription({ items: { data: [] } as unknown as Stripe.ApiList<Stripe.SubscriptionItem> }))).toThrowError(
      new StripeSubscriptionRejectedError("subscription_prices_invalid"),
    );
  });

  it("maps an active subscription to a restorable entitlement", () => {
    const result = reduceStripeSubscriptionState(current, snapshot());
    expect(result).toMatchObject({ applied: true, workspaceAction: "restore_if_billing_paused", subscription: { status: "active" } });
  });

  it("ignores an event older than the applied Stripe event", () => {
    const result = reduceStripeSubscriptionState({
      ...current,
      status: "active",
      stripeSubscriptionId: "sub_current",
      lastStripeEventCreatedAt: new Date(2_000_000),
    }, snapshot(subscription({ status: "past_due" }), 1_000));
    expect(result).toEqual({ applied: false, reason: "stale_event" });
  });

  it("does not resurrect a canceled subscription", () => {
    const result = reduceStripeSubscriptionState({
      ...current,
      status: "canceled",
      stripeSubscriptionId: "sub_current",
      canceledAt: new Date(1_000_000),
    }, snapshot(subscription({ status: "active" }), 2_000));
    expect(result).toEqual({ applied: false, reason: "canceled_subscription_is_terminal" });
  });

  it("starts grace once and preserves it for repeated past_due snapshots", () => {
    const first = reduceStripeSubscriptionState({ ...current, status: "active", stripeSubscriptionId: "sub_current" }, snapshot(subscription({ status: "past_due" })));
    expect(first.applied && first.subscription.graceEndsAt).toEqual(new Date(1_000_000 + 72 * 3600_000));
    const graceEndsAt = new Date(9_999_999);
    const repeated = reduceStripeSubscriptionState({ ...current, status: "past_due", stripeSubscriptionId: "sub_current", graceEndsAt }, snapshot(subscription({ status: "past_due" }), 2_000));
    expect(repeated.applied && repeated.subscription.graceEndsAt).toEqual(graceEndsAt);
  });

  it("rejects replacement of an active subscription", () => {
    expect(() => reduceStripeSubscriptionState({ ...current, status: "active", stripeSubscriptionId: "sub_other" }, snapshot())).toThrowError(
      new StripeSubscriptionRejectedError("active_subscription_replacement_forbidden"),
    );
  });
});
