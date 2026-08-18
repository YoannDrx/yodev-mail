import { and, eq, inArray, lt, sql } from "drizzle-orm";
import Stripe from "stripe";
import { requireDb } from "@/db/runtime";
import { stripeUsageReportJobs, usageLedger, usageMonths } from "@/db/schema";
import { isFeatureEnabled } from "@/lib/env";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

function stripeErrorCode(error: unknown) {
  if (error instanceof Stripe.errors.StripeError) return error.code ?? error.type;
  return "stripe_usage_submission_unknown";
}

export async function handler() {
  if (!isFeatureEnabled("STRIPE_USAGE_REPORTING_ENABLED")) {
    return { reported: 0, disabled: true, unknown: 0 };
  }
  await loadRuntimeSecrets(["DATABASE_URL", "STRIPE_SECRET_KEY"]);
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe usage reporting is not configured");
  const stripe = new Stripe(secret);
  const db = requireDb();
  const now = new Date();
  const staleClaim = new Date(now.getTime() - 15 * 60_000);
  const minimumStripeTimestamp = new Date(now.getTime() - 35 * 864e5);

  const stale = await db.update(stripeUsageReportJobs).set({
    status: "unknown",
    claimedAt: null,
    lastErrorCode: "stale_submission_outcome_unknown",
    updatedAt: now,
  }).where(and(
    eq(stripeUsageReportJobs.status, "processing"),
    lt(stripeUsageReportJobs.claimedAt, staleClaim),
  )).returning({ id: stripeUsageReportJobs.id });

  const tooOld = await db.update(stripeUsageReportJobs).set({
    status: "unreportable",
    claimedAt: null,
    lastErrorCode: "meter_timestamp_too_old",
    updatedAt: now,
  }).where(and(
    inArray(stripeUsageReportJobs.status, ["pending", "failed"]),
    lt(stripeUsageReportJobs.acceptedAt, minimumStripeTimestamp),
  )).returning({ id: stripeUsageReportJobs.id });

  const candidates = await db.select().from(stripeUsageReportJobs).where(
    inArray(stripeUsageReportJobs.status, ["pending", "failed"]),
  ).limit(1_000);

  let reported = 0;
  let unknown = stale.length + tooOld.length;
  for (const candidate of candidates) {
    const claimTime = new Date();
    const [claimed] = await db.update(stripeUsageReportJobs).set({
      status: "processing",
      claimedAt: claimTime,
      attemptCount: sql`${stripeUsageReportJobs.attemptCount} + 1`,
      lastErrorCode: null,
      updatedAt: claimTime,
    }).where(and(
      eq(stripeUsageReportJobs.id, candidate.id),
      eq(stripeUsageReportJobs.workspaceId, candidate.workspaceId),
      inArray(stripeUsageReportJobs.status, ["pending", "failed"]),
    )).returning({ id: stripeUsageReportJobs.id });
    if (!claimed) continue;

    let submitted = false;
    try {
      await stripe.billing.meterEvents.create({
        event_name: process.env.STRIPE_METER_EVENT_NAME ?? "yodev_mail_emails_sent",
        identifier: candidate.stripeIdentifier,
        payload: {
          stripe_customer_id: candidate.stripeCustomerId,
          value: "1",
        },
        timestamp: Math.floor(candidate.acceptedAt.getTime() / 1_000),
      });
      submitted = true;
      const month = candidate.acceptedAt.toISOString().slice(0, 7);
      await db.transaction(async (tx) => {
        const [finalized] = await tx.update(stripeUsageReportJobs).set({
          status: "reported",
          claimedAt: null,
          reportedAt: new Date(),
          updatedAt: new Date(),
        }).where(and(
          eq(stripeUsageReportJobs.id, candidate.id),
          eq(stripeUsageReportJobs.workspaceId, candidate.workspaceId),
          eq(stripeUsageReportJobs.status, "processing"),
          eq(stripeUsageReportJobs.claimedAt, claimTime),
        )).returning({ id: stripeUsageReportJobs.id });
        if (!finalized) throw new Error("stripe_usage_claim_lost");
        await tx.update(usageMonths).set({
          stripeReportedEmails: sql`${usageMonths.stripeReportedEmails} + 1`,
          updatedAt: new Date(),
        }).where(and(
          eq(usageMonths.workspaceId, candidate.workspaceId),
          eq(usageMonths.month, month),
        ));
        await tx.update(usageLedger).set({
          stripeReportedAt: new Date(),
        }).where(and(
          eq(usageLedger.messageId, candidate.messageId),
          eq(usageLedger.workspaceId, candidate.workspaceId),
        ));
      });
      reported += 1;
    } catch (error) {
      unknown += 1;
      await db.update(stripeUsageReportJobs).set({
        status: "unknown",
        claimedAt: null,
        lastErrorCode: submitted ? "database_commit_after_stripe_failed" : stripeErrorCode(error),
        updatedAt: new Date(),
      }).where(and(
        eq(stripeUsageReportJobs.id, candidate.id),
        eq(stripeUsageReportJobs.workspaceId, candidate.workspaceId),
        eq(stripeUsageReportJobs.status, "processing"),
        eq(stripeUsageReportJobs.claimedAt, claimTime),
      ));
    }
  }

  if (unknown) throw new Error(`Stripe usage reporting has ${unknown} ambiguous or unreportable job(s)`);
  return { reported, disabled: false, unknown: 0 };
}
