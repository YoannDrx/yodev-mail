import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import Stripe from "stripe";
import { requireDb } from "@/db/runtime";
import { stripeUsageReportJobs, stripeUsageReports } from "@/db/schema";
import { isFeatureEnabled } from "@/lib/env";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

// A Lambda that dies mid-call leaves its claim behind for at least this long.
const STALE_CLAIM_MS = 15 * 60_000;
// Stripe keeps idempotency keys for 24 hours and deduplicates meter-event
// identifiers for at least 24 hours. Resending the same aggregate inside this
// shorter window can never be counted twice; after it, a human must reconcile.
const SAFE_RETRY_WINDOW_MS = 20 * 3600_000;
// Stripe rejects meter events older than 35 days.
const METER_MAX_AGE_MS = 35 * 864e5;
const ASSIGNMENT_BATCH = 20_000;
const REPORT_PAGE = 200;
const DEFAULT_BUDGET_MS = 45_000;
// Keep enough Lambda time for one Stripe call (10 s timeout) and its commit.
const PER_CALL_RESERVE_MS = 15_000;
const IN_RUN_ATTEMPTS = 3;

type LambdaContext = { getRemainingTimeInMillis(): number };
export type StripeFailureKind = "retryable" | "configuration" | "rejected" | "ambiguous";

function stripeErrorCode(error: unknown) {
  if (error instanceof Stripe.errors.StripeError) return (error.code ?? error.type).slice(0, 120);
  return "stripe_usage_submission_unknown";
}

/**
 * Only failures that cannot have recorded usage twice are retried:
 * - 429 and authentication/permission errors are rejected before execution;
 * - connection errors and 5xx responses are resent with the same idempotency
 *   key and meter identifier, which Stripe deduplicates (see SAFE_RETRY_WINDOW_MS).
 * A 4xx validation error is definitive. Anything else is ambiguous.
 */
export function classifyStripeUsageError(error: unknown): StripeFailureKind {
  if (!(error instanceof Stripe.errors.StripeError)) return "ambiguous";
  const status = error.statusCode;
  // The same key was used with other parameters: never resend automatically.
  if (error.type === "StripeIdempotencyError") return "ambiguous";
  if (status === 429 || error.type === "StripeRateLimitError") return "retryable";
  if (error.type === "StripeConnectionError" || error.type === "StripeAPIError" || (status !== undefined && status >= 500)) {
    return "retryable";
  }
  // Concurrent use of the same key or a lock timeout: nothing was recorded yet.
  if (status === 409) return "retryable";
  if (status === 401 || status === 403 || error.type === "StripeAuthenticationError" || error.type === "StripePermissionError") {
    return "configuration";
  }
  if (status !== undefined && status >= 400 && status < 500) return "rejected";
  return "ambiguous";
}

async function settleReportJobs(
  reportId: string,
  workspaceId: string,
  status: "unknown" | "unreportable",
  code: string,
  now: Date,
) {
  await requireDb().update(stripeUsageReportJobs).set({
    status,
    claimedAt: null,
    lastErrorCode: code,
    updatedAt: now,
  }).where(and(
    eq(stripeUsageReportJobs.reportId, reportId),
    eq(stripeUsageReportJobs.workspaceId, workspaceId),
    eq(stripeUsageReportJobs.status, "processing"),
  ));
}

/** Legacy single-email claims and expired jobs from before aggregation. */
async function reclassifyLegacyJobs(now: Date) {
  const db = requireDb();
  const staleClaim = new Date(now.getTime() - STALE_CLAIM_MS);
  const minimumStripeTimestamp = new Date(now.getTime() - METER_MAX_AGE_MS);
  const stale = await db.update(stripeUsageReportJobs).set({
    status: "unknown",
    claimedAt: null,
    lastErrorCode: "stale_submission_outcome_unknown",
    updatedAt: now,
  }).where(and(
    eq(stripeUsageReportJobs.status, "processing"),
    isNull(stripeUsageReportJobs.reportId),
    lt(stripeUsageReportJobs.claimedAt, staleClaim),
  )).returning({ id: stripeUsageReportJobs.id });
  const tooOld = await db.update(stripeUsageReportJobs).set({
    status: "unreportable",
    claimedAt: null,
    lastErrorCode: "meter_timestamp_too_old",
    updatedAt: now,
  }).where(and(
    inArray(stripeUsageReportJobs.status, ["pending", "failed"]),
    isNull(stripeUsageReportJobs.reportId),
    lt(stripeUsageReportJobs.acceptedAt, minimumStripeTimestamp),
  )).returning({ id: stripeUsageReportJobs.id });
  return stale.length + tooOld.length;
}

/** A claim abandoned by a dead Lambda is resent while that is still safe. */
async function recoverStaleReports(now: Date) {
  const db = requireDb();
  const staleClaim = new Date(now.getTime() - STALE_CLAIM_MS);
  const retryHorizon = new Date(now.getTime() - SAFE_RETRY_WINDOW_MS);
  await db.update(stripeUsageReports).set({
    status: "failed",
    claimedAt: null,
    nextAttemptAt: now,
    lastErrorCode: "stale_claim_resent",
    updatedAt: now,
  }).where(and(
    eq(stripeUsageReports.status, "processing"),
    lt(stripeUsageReports.claimedAt, staleClaim),
    gte(stripeUsageReports.firstAttemptedAt, retryHorizon),
  ));
  const expired = await db.update(stripeUsageReports).set({
    status: "unknown",
    claimedAt: null,
    lastErrorCode: "stale_submission_outcome_unknown",
    updatedAt: now,
  }).where(and(
    inArray(stripeUsageReports.status, ["processing", "failed"]),
    lt(stripeUsageReports.firstAttemptedAt, retryHorizon),
  )).returning({ id: stripeUsageReports.id, workspaceId: stripeUsageReports.workspaceId });
  for (const report of expired) {
    await settleReportJobs(report.id, report.workspaceId, "unknown", "stale_submission_outcome_unknown", now);
  }
  return expired.length;
}

/**
 * Group unassigned jobs into one aggregate per workspace, Stripe customer,
 * subscription and UTC hour. The meter timestamp is the latest acceptance in
 * the group, so usage is never attributed to an earlier billing period.
 */
export async function assignUsageJobsToReports(now = new Date(), limit = ASSIGNMENT_BATCH) {
  const minimumStripeTimestamp = new Date(now.getTime() - METER_MAX_AGE_MS).toISOString();
  const result = await requireDb().execute(sql`
    with candidates as materialized (
      select id, workspace_id, stripe_customer_id, stripe_subscription_id, accepted_at,
        date_trunc('hour', accepted_at at time zone 'UTC') at time zone 'UTC' as window_starts_at
      from stripe_usage_report_jobs
      where status in ('pending', 'failed') and report_id is null
        and accepted_at >= ${minimumStripeTimestamp}::timestamptz
      order by created_at, id
      limit ${limit}
      for update skip locked
    ), groups as materialized (
      select gen_random_uuid() as id, workspace_id, stripe_customer_id, stripe_subscription_id,
        window_starts_at, max(accepted_at) as event_timestamp, count(*)::int as quantity
      from candidates
      group by workspace_id, stripe_customer_id, stripe_subscription_id, window_starts_at
    ), inserted as (
      insert into stripe_usage_reports (id, workspace_id, stripe_customer_id, stripe_subscription_id,
        window_starts_at, event_timestamp, quantity, stripe_identifier, next_attempt_at)
      select id, workspace_id, stripe_customer_id, stripe_subscription_id, window_starts_at,
        event_timestamp, quantity, 'ymr-' || id::text, ${now.toISOString()}::timestamptz
      from groups
      returning id
    )
    update stripe_usage_report_jobs as job
    set report_id = groups.id, status = 'processing', claimed_at = null, last_error_code = null,
      updated_at = ${now.toISOString()}::timestamptz
    from candidates
    join groups on groups.workspace_id = candidates.workspace_id
      and groups.stripe_customer_id = candidates.stripe_customer_id
      and groups.stripe_subscription_id = candidates.stripe_subscription_id
      and groups.window_starts_at = candidates.window_starts_at
    where job.id = candidates.id and job.workspace_id = candidates.workspace_id
  `);
  return result.rowCount ?? 0;
}

/** Marks the aggregate and its jobs reported, with every local accounting marker, atomically. */
async function finalizeReport(report: typeof stripeUsageReports.$inferSelect, claimTime: Date) {
  const reportedAt = new Date();
  return requireDb().transaction(async (tx) => {
    const [finalized] = await tx.update(stripeUsageReports).set({
      status: "reported",
      claimedAt: null,
      reportedAt,
      lastErrorCode: null,
      updatedAt: reportedAt,
    }).where(and(
      eq(stripeUsageReports.id, report.id),
      eq(stripeUsageReports.workspaceId, report.workspaceId),
      eq(stripeUsageReports.status, "processing"),
      eq(stripeUsageReports.claimedAt, claimTime),
    )).returning({ id: stripeUsageReports.id });
    if (!finalized) throw new Error("stripe_usage_claim_lost");
    const at = reportedAt.toISOString();
    const jobs = await tx.execute(sql`
      with reported as (
        update stripe_usage_report_jobs
        set status = 'reported', claimed_at = null, reported_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
        where workspace_id = ${report.workspaceId} and report_id = ${report.id} and status = 'processing'
        returning message_id, accepted_at
      ), ledger as (
        update usage_ledger set stripe_reported_at = ${at}::timestamptz
        from reported
        where usage_ledger.workspace_id = ${report.workspaceId} and usage_ledger.message_id = reported.message_id
        returning usage_ledger.message_id
      ), months as (
        select to_char(accepted_at at time zone 'UTC', 'YYYY-MM') as month, count(*)::bigint as emails
        from reported group by 1
      ), monthly as (
        update usage_months set stripe_reported_emails = usage_months.stripe_reported_emails + months.emails,
          updated_at = ${at}::timestamptz
        from months
        where usage_months.workspace_id = ${report.workspaceId} and usage_months.month = months.month
        returning usage_months.id
      )
      select (select count(*) from reported)::int as jobs,
        (select count(*) from ledger)::int as ledger,
        (select count(*) from monthly)::int as months
    `);
    const counts = jobs.rows[0] as { jobs: number } | undefined;
    return counts?.jobs ?? 0;
  });
}

async function markReport(
  report: typeof stripeUsageReports.$inferSelect,
  claimTime: Date,
  values: Partial<typeof stripeUsageReports.$inferInsert>,
) {
  const [updated] = await requireDb().update(stripeUsageReports).set({ ...values, claimedAt: null, updatedAt: new Date() }).where(and(
    eq(stripeUsageReports.id, report.id),
    eq(stripeUsageReports.workspaceId, report.workspaceId),
    eq(stripeUsageReports.status, "processing"),
    eq(stripeUsageReports.claimedAt, claimTime),
  )).returning({ id: stripeUsageReports.id });
  return Boolean(updated);
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function handler(_event?: unknown, context?: LambdaContext) {
  if (!isFeatureEnabled("STRIPE_USAGE_REPORTING_ENABLED")) {
    return { reported: 0, reports: 0, retrying: 0, disabled: true, unknown: 0 };
  }
  await loadRuntimeSecrets(["DATABASE_URL", "STRIPE_USAGE_SECRET_KEY"]);
  const secret = process.env.STRIPE_USAGE_SECRET_KEY;
  if (!secret) throw new Error("Stripe usage reporting is not configured");
  // Bounded requests: network retries reuse the same idempotency key.
  const stripe = new Stripe(secret, { maxNetworkRetries: 1, timeout: 10_000 });
  const eventName = process.env.STRIPE_METER_EVENT_NAME ?? "yodev_mail_emails_sent";
  const db = requireDb();
  const startedAt = Date.now();
  const remaining = () => Math.min(
    DEFAULT_BUDGET_MS - (Date.now() - startedAt),
    context ? context.getRemainingTimeInMillis() - PER_CALL_RESERVE_MS : Number.POSITIVE_INFINITY,
  );
  const hasTimeForCall = () => remaining() > PER_CALL_RESERVE_MS;

  const now = new Date();
  let unknown = await reclassifyLegacyJobs(now);
  unknown += await recoverStaleReports(now);
  await assignUsageJobsToReports(now);

  let reported = 0;
  let reports = 0;
  let retrying = 0;
  let configurationError = false;
  const seen = new Set<string>();
  outer: while (hasTimeForCall()) {
    const due = await db.select().from(stripeUsageReports).where(and(
      inArray(stripeUsageReports.status, ["pending", "failed"]),
      lte(stripeUsageReports.nextAttemptAt, new Date()),
    )).orderBy(asc(stripeUsageReports.nextAttemptAt), asc(stripeUsageReports.createdAt)).limit(REPORT_PAGE);
    const fresh = due.filter((report) => !seen.has(report.id));
    if (!fresh.length) break;
    for (const report of fresh) {
      if (!hasTimeForCall()) break outer;
      seen.add(report.id);
      if (report.eventTimestamp.getTime() < Date.now() - METER_MAX_AGE_MS) {
        const [expired] = await db.update(stripeUsageReports).set({
          status: "unreportable",
          lastErrorCode: "meter_timestamp_too_old",
          updatedAt: new Date(),
        }).where(and(
          eq(stripeUsageReports.id, report.id),
          eq(stripeUsageReports.workspaceId, report.workspaceId),
          inArray(stripeUsageReports.status, ["pending", "failed"]),
        )).returning({ id: stripeUsageReports.id });
        if (expired) {
          await settleReportJobs(report.id, report.workspaceId, "unreportable", "meter_timestamp_too_old", new Date());
          unknown += 1;
        }
        continue;
      }
      const claimTime = new Date();
      const [claimed] = await db.update(stripeUsageReports).set({
        status: "processing",
        claimedAt: claimTime,
        firstAttemptedAt: sql`coalesce(${stripeUsageReports.firstAttemptedAt}, ${claimTime.toISOString()}::timestamptz)`,
        lastErrorCode: null,
        updatedAt: claimTime,
      }).where(and(
        eq(stripeUsageReports.id, report.id),
        eq(stripeUsageReports.workspaceId, report.workspaceId),
        inArray(stripeUsageReports.status, ["pending", "failed"]),
      )).returning();
      if (!claimed) continue;

      let outcome: { kind: "submitted" } | { kind: StripeFailureKind; code: string } = { kind: "ambiguous", code: "not_attempted" };
      for (let attempt = 1; attempt <= IN_RUN_ATTEMPTS; attempt += 1) {
        await db.update(stripeUsageReports).set({ attemptCount: sql`${stripeUsageReports.attemptCount} + 1` }).where(and(
          eq(stripeUsageReports.id, claimed.id),
          eq(stripeUsageReports.workspaceId, claimed.workspaceId),
        ));
        try {
          await stripe.billing.meterEvents.create({
            event_name: eventName,
            identifier: claimed.stripeIdentifier,
            payload: {
              stripe_customer_id: claimed.stripeCustomerId,
              value: String(claimed.quantity),
            },
            timestamp: Math.floor(claimed.eventTimestamp.getTime() / 1_000),
          }, { idempotencyKey: claimed.stripeIdentifier });
          outcome = { kind: "submitted" };
          break;
        } catch (error) {
          outcome = { kind: classifyStripeUsageError(error), code: stripeErrorCode(error) };
          const backoff = 250 * 2 ** attempt;
          if (outcome.kind !== "retryable" || attempt === IN_RUN_ATTEMPTS || remaining() < backoff + PER_CALL_RESERVE_MS) break;
          await wait(backoff);
        }
      }

      if (outcome.kind === "submitted") {
        try {
          reported += await finalizeReport(claimed, claimTime);
          reports += 1;
        } catch {
          // Stripe has the event; only local accounting failed. Never resend blindly.
          if (await markReport(claimed, claimTime, { status: "unknown", lastErrorCode: "database_commit_after_stripe_failed" })) {
            await settleReportJobs(claimed.id, claimed.workspaceId, "unknown", "database_commit_after_stripe_failed", new Date());
          }
          unknown += 1;
        }
        continue;
      }
      if (outcome.kind === "retryable" || outcome.kind === "configuration") {
        // The next scheduled run (hourly) resends it with the same identifier.
        await markReport(claimed, claimTime, { status: "failed", nextAttemptAt: new Date(Date.now() + 5 * 60_000), lastErrorCode: outcome.code });
        retrying += 1;
        if (outcome.kind === "configuration") {
          // Every other aggregate would fail the same way; keep them pending.
          configurationError = true;
          break outer;
        }
        continue;
      }
      const status = outcome.kind === "rejected" ? "unreportable" : "unknown";
      if (await markReport(claimed, claimTime, { status, lastErrorCode: outcome.code })) {
        await settleReportJobs(claimed.id, claimed.workspaceId, status, outcome.code, new Date());
      }
      unknown += 1;
    }
  }

  if (configurationError) throw new Error("Stripe usage reporting is rejected by Stripe configuration");
  if (unknown) throw new Error(`Stripe usage reporting has ${unknown} ambiguous or unreportable report(s)`);
  return { reported, reports, retrying, disabled: false, unknown: 0 };
}
