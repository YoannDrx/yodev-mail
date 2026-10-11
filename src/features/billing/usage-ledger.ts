import { and, eq, inArray, sql } from "drizzle-orm";
import {
  stripeUsageReportJobs,
  subscriptions,
  usageDays,
  usageLedger,
  usageMonths,
} from "@/db/schema";
import { stripeMeterableSubscriptionStatuses } from "@/features/billing/stripe-state";
import { utcDay } from "@/features/sending/eligibility";
import type { DatabaseTransaction } from "@/features/webhooks/public-email-event";

/**
 * Records one provider-accepted message exactly once: the usage ledger row is
 * the idempotency guard for the Stripe usage job and the daily/monthly
 * counters. Returns false when the message was already recorded.
 */
export async function recordAcceptedUsageInTransaction(
  tx: DatabaseTransaction,
  input: { workspaceId: string; messageId: string; acceptedAt: Date },
) {
  const { acceptedAt, messageId, workspaceId } = input;
  const ledger = await tx.insert(usageLedger)
    .values({ acceptedAt, messageId, workspaceId })
    .onConflictDoNothing()
    .returning({ messageId: usageLedger.messageId });
  if (!ledger.length) return false;

  const [billableSubscription] = await tx.select({
    customerId: subscriptions.stripeCustomerId,
    id: subscriptions.stripeSubscriptionId,
  }).from(subscriptions).where(and(
    eq(subscriptions.workspaceId, workspaceId),
    inArray(subscriptions.status, [...stripeMeterableSubscriptionStatuses]),
    eq(subscriptions.plan, "beta"),
  )).limit(1);
  if (billableSubscription?.customerId && billableSubscription.id) {
    await tx.insert(stripeUsageReportJobs).values({
      workspaceId,
      messageId,
      acceptedAt,
      stripeIdentifier: `ym-${messageId}`,
      stripeCustomerId: billableSubscription.customerId,
      stripeSubscriptionId: billableSubscription.id,
    }).onConflictDoNothing();
  }
  await tx.insert(usageDays).values({ workspaceId, day: utcDay(acceptedAt), acceptedEmails: 1 }).onConflictDoUpdate({
    target: [usageDays.workspaceId, usageDays.day],
    set: { acceptedEmails: sql`${usageDays.acceptedEmails} + 1`, updatedAt: new Date() },
  });
  await tx.insert(usageMonths).values({ workspaceId, month: acceptedAt.toISOString().slice(0, 7), acceptedEmails: 1 }).onConflictDoUpdate({
    target: [usageMonths.workspaceId, usageMonths.month],
    set: { acceptedEmails: sql`${usageMonths.acceptedEmails} + 1`, updatedAt: new Date() },
  });
  return true;
}

/** Releases the quota reservation taken when the message was queued. */
export async function releaseReservationInTransaction(
  tx: DatabaseTransaction,
  workspaceId: string,
  reservedAt: Date,
) {
  await tx
    .update(usageDays)
    .set({
      reservedEmails: sql`greatest(${usageDays.reservedEmails} - 1, 0)`,
      updatedAt: new Date(),
    })
    .where(and(eq(usageDays.workspaceId, workspaceId), eq(usageDays.day, utcDay(reservedAt))));
}
