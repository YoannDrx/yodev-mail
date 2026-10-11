import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/runtime";
import { workspaces } from "@/db/schema";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

const batchSize = 100;
const workspaceBatchSize = 50;
const globalBatchSize = 500;

/**
 * Retention periods for records that are not message content (content and
 * addressing follow the 30-day / 90-day contract below):
 * - message attempts: 90 days, aligned with message redaction and the
 *   deletion of technical events (attempts can carry provider error text);
 * - audit events: 13 months (a full year of security history plus margin);
 * - usage days: 25 months (two billing years for disputes; monthly
 *   aggregates in usage_months and Stripe invoices remain);
 * - Stripe webhook events: 90 days (Stripe retries for 3 days at most; the
 *   table only deduplicates deliveries);
 * - beta applications: the hashed client IP after 30 days, the whole
 *   application after 12 months.
 */
export const retentionPeriods = {
  messageAttemptsDays: 90,
  auditEventsMonths: 13,
  usageDaysMonths: 25,
  stripeEventsDays: 90,
  betaApplicationIpHashDays: 30,
  betaApplicationsMonths: 12,
} as const;

function monthsBefore(now: Date, months: number) {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

/** No provider calls, no ledger deletion. Every business mutation is tenant-scoped. */
export async function purgeWorkspaceRetention(workspaceId: string, now = new Date(), limit = batchSize) {
  z.uuid().parse(workspaceId);
  z.number().int().min(1).max(batchSize).parse(limit);
  const cutoff = new Date(now.getTime() - 90 * 864e5).toISOString();
  const current = now.toISOString();
  return requireDb().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '2s'`);
    await tx.execute(sql`set local lock_timeout = '500ms'`);
    // Lock selected rows in a stable order; concurrent sweeps are idempotent.
    const bodies = await tx.execute(sql`
      with candidates as (
        select id from messages where workspace_id = ${workspaceId}
          and content_expires_at <= ${current}::timestamptz
        order by content_expires_at, id limit ${limit} for update skip locked
      ) update messages set subject = '[contenu expiré]', html = '', plain_text = '',
          content_expires_at = null, updated_at = ${current}::timestamptz
        where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const events = await tx.execute(sql`
      with candidates as (
        select id from email_events where workspace_id = ${workspaceId} and occurred_at < ${cutoff}::timestamptz
        order by occurred_at, id limit ${limit} for update skip locked
      ) delete from email_events where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const messages = await tx.execute(sql`
      with candidates as (
        select id from messages where workspace_id = ${workspaceId} and queued_at < ${cutoff}::timestamptz
          and to_email <> 'redacted@yodev.invalid'
        order by queued_at, id limit ${limit} for update skip locked
      ) update messages set from_email = 'redacted@yodev.invalid', from_name = null,
          to_email = 'redacted@yodev.invalid', to_name = null, reply_to = null,
          subject = '[contenu expiré]', html = '', plain_text = '', content_expires_at = null,
          tags = '{}'::jsonb, last_error = null, updated_at = ${current}::timestamptz
        where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const suppressions = await tx.execute(sql`
      with candidates as (
        select id from suppressions where workspace_id = ${workspaceId} and created_at < ${cutoff}::timestamptz
          and normalized_email is not null
        order by created_at, id limit ${limit} for update skip locked
      ) update suppressions set normalized_email = null
        where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const keys = await tx.execute(sql`
      with candidates as (
        select id from idempotency_keys where workspace_id = ${workspaceId} and created_at < ${cutoff}::timestamptz
        order by created_at, id limit ${limit} for update skip locked
      ) delete from idempotency_keys where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const jobs = await tx.execute(sql`
      with candidates as (
        select id from outbox_jobs where workspace_id = ${workspaceId} and status = 'delivered'
          and updated_at < ${cutoff}::timestamptz
        order by updated_at, id limit ${limit} for update skip locked
      ) delete from outbox_jobs where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const attemptsCutoff = new Date(now.getTime() - retentionPeriods.messageAttemptsDays * 864e5).toISOString();
    const attempts = await tx.execute(sql`
      with candidates as (
        select id from message_attempts where workspace_id = ${workspaceId} and created_at < ${attemptsCutoff}::timestamptz
        order by created_at, id limit ${limit} for update skip locked
      ) delete from message_attempts where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const auditCutoff = monthsBefore(now, retentionPeriods.auditEventsMonths).toISOString();
    const audits = await tx.execute(sql`
      with candidates as (
        select id from audit_events where workspace_id = ${workspaceId} and created_at < ${auditCutoff}::timestamptz
        order by created_at, id limit ${limit} for update skip locked
      ) delete from audit_events where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    const usageCutoff = monthsBefore(now, retentionPeriods.usageDaysMonths).toISOString().slice(0, 10);
    const usage = await tx.execute(sql`
      with candidates as (
        select id from usage_days where workspace_id = ${workspaceId} and day < ${usageCutoff}
        order by day, id limit ${limit} for update skip locked
      ) delete from usage_days where workspace_id = ${workspaceId} and id in (select id from candidates)`);
    return {
      expiredBodies: bodies.rowCount ?? 0,
      deletedEvents: events.rowCount ?? 0,
      anonymizedMessages: messages.rowCount ?? 0,
      anonymizedSuppressions: suppressions.rowCount ?? 0,
      deletedIdempotencyKeys: keys.rowCount ?? 0,
      deletedOutboxJobs: jobs.rowCount ?? 0,
      deletedMessageAttempts: attempts.rowCount ?? 0,
      deletedAuditEvents: audits.rowCount ?? 0,
      deletedUsageDays: usage.rowCount ?? 0,
    };
  });
}

/**
 * Control-plane records with no workspace: Stripe webhook deduplication,
 * platform audit events and public beta applications. Bounded per run.
 */
export async function purgeGlobalRetention(now = new Date(), limit = globalBatchSize) {
  z.number().int().min(1).max(globalBatchSize).parse(limit);
  const stripeCutoff = new Date(now.getTime() - retentionPeriods.stripeEventsDays * 864e5).toISOString();
  const auditCutoff = monthsBefore(now, retentionPeriods.auditEventsMonths).toISOString();
  const ipCutoff = new Date(now.getTime() - retentionPeriods.betaApplicationIpHashDays * 864e5).toISOString();
  const applicationCutoff = monthsBefore(now, retentionPeriods.betaApplicationsMonths).toISOString();
  return requireDb().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '2s'`);
    await tx.execute(sql`set local lock_timeout = '500ms'`);
    const stripeEvents = await tx.execute(sql`
      with candidates as (
        select event_id from stripe_events where created_at < ${stripeCutoff}::timestamptz
        order by created_at, event_id limit ${limit} for update skip locked
      ) delete from stripe_events where event_id in (select event_id from candidates)`);
    const audits = await tx.execute(sql`
      with candidates as (
        select id from audit_events where workspace_id is null and created_at < ${auditCutoff}::timestamptz
        order by created_at, id limit ${limit} for update skip locked
      ) delete from audit_events where workspace_id is null and id in (select id from candidates)`);
    const ipHashes = await tx.execute(sql`
      with candidates as (
        select id from beta_applications where ip_hash is not null and created_at < ${ipCutoff}::timestamptz
        order by created_at, id limit ${limit} for update skip locked
      ) update beta_applications set ip_hash = null where id in (select id from candidates)`);
    const applications = await tx.execute(sql`
      with candidates as (
        select id from beta_applications where created_at < ${applicationCutoff}::timestamptz
        order by created_at, id limit ${limit} for update skip locked
      ) delete from beta_applications where id in (select id from candidates)`);
    return {
      deletedStripeEvents: stripeEvents.rowCount ?? 0,
      deletedGlobalAuditEvents: audits.rowCount ?? 0,
      erasedApplicationIpHashes: ipHashes.rowCount ?? 0,
      deletedBetaApplications: applications.rowCount ?? 0,
    };
  });
}

export async function handler(_event?: unknown, context?: { getRemainingTimeInMillis(): number }) {
  await loadRuntimeSecrets();
  const db = requireDb();
  const deadline = Date.now() + 40_000;
  let checked = 0;
  let failed = 0;
  let saturated = 0;
  // Control-plane enumeration only: opaque IDs, including paused/deleted tenants.
  // Durable oldest-attempt ordering prevents a large or failing tenant from
  // starving others. Business data is accessed only by the scoped helper above.
  const candidates = await db.select({ id: workspaces.id }).from(workspaces)
    .orderBy(sql`${workspaces.retentionAttemptedAt} asc nulls first`, workspaces.id).limit(workspaceBatchSize);
  for (const { id: workspaceId } of candidates) {
    if (Date.now() >= deadline || (context && context.getRemainingTimeInMillis() < 20_000)) break;
    await db.update(workspaces).set({ retentionAttemptedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    try {
      const result = await purgeWorkspaceRetention(workspaceId);
      if (Object.values(result).some(count => count === batchSize)) saturated++;
    } catch {
      // Database errors can include query parameters. Emit only aggregate codes.
      failed++;
    }
    checked++;
  }
  let globalSaturated = false;
  if (Date.now() < deadline && !(context && context.getRemainingTimeInMillis() < 20_000)) {
    try {
      const result = await purgeGlobalRetention();
      globalSaturated = Object.values(result).some(count => count === globalBatchSize);
    } catch {
      failed++;
    }
  }
  emitOperationalMetric("RetentionPurgeFailure", failed);
  emitOperationalMetric("RetentionPurgeBacklog", saturated + Number(checked < candidates.length) + Number(globalSaturated));
  emitOperationalMetric("RetentionPurgeCompleted");
  return { checked, failed, saturated };
}
