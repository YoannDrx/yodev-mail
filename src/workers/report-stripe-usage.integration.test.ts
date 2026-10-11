import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  createMeterEvent: vi.fn(),
  enabled: true,
  loadRuntimeSecrets: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("stripe", () => {
  class StripeError extends Error {
    code?: string;
    type = "StripeError";
    statusCode?: number;
    constructor(input: { type?: string; statusCode?: number; code?: string } = {}) {
      super(input.type ?? "StripeError");
      if (input.type) this.type = input.type;
      this.statusCode = input.statusCode;
      this.code = input.code;
    }
  }
  class StripeClient {
    static errors = { StripeError };
    billing = { meterEvents: { create: dependencies.createMeterEvent } };
  }
  return { default: StripeClient };
});
vi.mock("@/lib/env", () => ({
  isFeatureEnabled: vi.fn(() => dependencies.enabled),
}));
vi.mock("@/workers/runtime-secrets", () => ({
  loadRuntimeSecrets: dependencies.loadRuntimeSecrets,
}));

import Stripe from "stripe";
import { databasePool, requireDb } from "@/db/runtime";
import {
  domains,
  messages,
  stripeUsageReportJobs,
  stripeUsageReports,
  transactionalProfiles,
  usageLedger,
  usageMonths,
  workspaces,
} from "@/db/schema";
import { classifyStripeUsageError, handler as reportStripeUsage } from "@/workers/report-stripe-usage";

const db = requireDb();
const pool = databasePool!;
const StripeError = Stripe.errors.StripeError as unknown as new (input?: { type?: string; statusCode?: number; code?: string }) => Error;

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = result.rows
    .map(({ tablename }) => tablename)
    .filter((name) => /^[a-z0-9_]+$/.test(name))
    .map((name) => `\"${name}\"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function seedWorkspace() {
  const workspaceId = randomUUID();
  const domainId = randomUUID();
  const profileId = randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Stripe usage integration",
    slug: `stripe-${workspaceId.slice(0, 8)}`,
    status: "approved",
  });
  await db.insert(domains).values({
    id: domainId,
    workspaceId,
    name: `${workspaceId}.example.com`,
    status: "verified",
    dkimStatus: "verified",
    activeProvider: "postmark",
  });
  await db.insert(transactionalProfiles).values({
    id: profileId,
    workspaceId,
    key: "receipt",
    name: "Receipt",
    triggerDescription: "Purchase completed",
    recipientRelationship: "Customer",
    contentExample: "Receipt",
    status: "approved",
  });
  return { domainId, profileId, workspaceId };
}

async function seedUsageJob(acceptedAt = new Date()) {
  const { domainId, profileId, workspaceId } = await seedWorkspace();
  const messageId = randomUUID();
  const month = acceptedAt.toISOString().slice(0, 7);
  await db.insert(messages).values({
    id: messageId,
    workspaceId,
    domainId,
    transactionalProfileId: profileId,
    provider: "postmark",
    contentKind: "template",
    stream: "transactional",
    sendMode: "live",
    status: "sent",
    fromEmail: "sender@example.com",
    toEmail: "recipient@example.net",
    subject: "Receipt",
    html: "<p>Receipt</p>",
    plainText: "Receipt",
    acceptedAt,
  });
  await db.insert(usageLedger).values({ workspaceId, messageId, acceptedAt });
  await db.insert(usageMonths).values({ workspaceId, month, acceptedEmails: 1 });
  const [job] = await db.insert(stripeUsageReportJobs).values({
    workspaceId,
    messageId,
    acceptedAt,
    stripeIdentifier: `ym-${messageId}`,
    stripeCustomerId: "cus_integration",
    stripeSubscriptionId: "sub_integration",
  }).returning();
  return { job, messageId, month, workspaceId };
}

/** Bulk-seeds accepted messages with their ledger rows, monthly counters and usage jobs. */
async function seedBulkUsage(count: number, hours: number) {
  const context = await seedWorkspace();
  const base = new Date(Date.now() - 6 * 3600_000);
  base.setUTCMinutes(0, 0, 0);
  await pool.query(`
    insert into messages (id, workspace_id, domain_id, transactional_profile_id, provider, content_kind, stream, send_mode,
      status, from_email, to_email, subject, html, plain_text, accepted_at)
    select gen_random_uuid(), $1, $2, $3, 'postmark', 'template', 'transactional', 'live', 'sent',
      'sender@example.com', 'recipient@example.net', 'Receipt', '', '', $4::timestamptz + ((n % $6) * interval '1 hour') + (n * interval '1 millisecond')
    from generate_series(1, $5) as n`, [context.workspaceId, context.domainId, context.profileId, base.toISOString(), count, hours]);
  await pool.query(`insert into usage_ledger (message_id, workspace_id, accepted_at)
    select id, workspace_id, accepted_at from messages where workspace_id = $1`, [context.workspaceId]);
  await pool.query(`insert into usage_months (workspace_id, month, accepted_emails)
    select workspace_id, to_char(accepted_at at time zone 'UTC', 'YYYY-MM'), count(*) from messages where workspace_id = $1 group by 1, 2`, [context.workspaceId]);
  await pool.query(`insert into stripe_usage_report_jobs (workspace_id, message_id, accepted_at, stripe_identifier, stripe_customer_id, stripe_subscription_id)
    select workspace_id, id, accepted_at, 'ym-' || id::text, 'cus_' || left(workspace_id::text, 8), 'sub_' || left(workspace_id::text, 8)
    from messages where workspace_id = $1`, [context.workspaceId]);
  return context;
}

beforeEach(async () => {
  await cleanDatabase();
  dependencies.createMeterEvent.mockReset();
  dependencies.enabled = true;
  dependencies.loadRuntimeSecrets.mockReset();
  process.env.STRIPE_USAGE_SECRET_KEY = "usage-secret-integration";
  process.env.STRIPE_METER_EVENT_NAME = "yodev_mail_emails_sent";
});

afterAll(async () => {
  delete process.env.STRIPE_USAGE_SECRET_KEY;
  delete process.env.STRIPE_METER_EVENT_NAME;
  await pool.end();
});

describe("Stripe usage reporting", () => {
  it("is fail-closed without loading secrets when the gate is disabled", async () => {
    dependencies.enabled = false;

    await expect(reportStripeUsage()).resolves.toMatchObject({ reported: 0, disabled: true, unknown: 0 });

    expect(dependencies.loadRuntimeSecrets).not.toHaveBeenCalled();
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("reports one aggregated meter event and commits all local accounting markers", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockResolvedValue({});

    await expect(reportStripeUsage()).resolves.toEqual({ reported: 1, reports: 1, retrying: 0, disabled: false, unknown: 0 });

    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    const [month] = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
    const [ledger] = await db.select().from(usageLedger).where(eq(usageLedger.messageId, context.messageId));
    expect(job).toMatchObject({ claimedAt: null, status: "reported", reportId: report.id });
    expect(job.reportedAt).toBeInstanceOf(Date);
    expect(report).toMatchObject({ status: "reported", quantity: 1, attemptCount: 1, stripeIdentifier: `ymr-${report.id}` });
    expect(month.stripeReportedEmails).toBe(1);
    expect(ledger.stripeReportedAt).toBeInstanceOf(Date);
    expect(dependencies.createMeterEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_name: "yodev_mail_emails_sent",
      identifier: report.stripeIdentifier,
      payload: { stripe_customer_id: "cus_integration", value: "1" },
      timestamp: Math.floor(context.job.acceptedAt.getTime() / 1000),
    }), { idempotencyKey: report.stripeIdentifier });
  });

  it("reports 5,000 jobs as a few aggregated meter events with no orphan", async () => {
    const first = await seedBulkUsage(3_000, 3);
    const second = await seedBulkUsage(2_000, 2);
    dependencies.createMeterEvent.mockResolvedValue({});

    const result = await reportStripeUsage();

    expect(result).toMatchObject({ reported: 5_000, reports: 5, retrying: 0, unknown: 0 });
    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(5);
    const values = dependencies.createMeterEvent.mock.calls.map(([params]) => Number(params.payload.value));
    expect(values.reduce((sum, value) => sum + value, 0)).toBe(5_000);
    const identifiers = dependencies.createMeterEvent.mock.calls.map(([params]) => params.identifier);
    expect(new Set(identifiers).size).toBe(5);
    const { rows: [jobs] } = await pool.query<{ open: number; reported: number }>(`select
      count(*) filter (where status <> 'reported')::int as open, count(*) filter (where status = 'reported')::int as reported
      from stripe_usage_report_jobs`);
    expect(jobs).toEqual({ open: 0, reported: 5_000 });
    const { rows: [ledger] } = await pool.query<{ missing: number }>("select count(*)::int as missing from usage_ledger where stripe_reported_at is null");
    expect(ledger.missing).toBe(0);
    for (const context of [first, second]) {
      const months = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
      for (const month of months) expect(month.stripeReportedEmails).toBe(month.acceptedEmails);
    }
  });

  it("retries a rate-limited submission with the same identifier", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent
      .mockRejectedValueOnce(new StripeError({ type: "StripeRateLimitError", statusCode: 429, code: "rate_limit" }))
      .mockResolvedValueOnce({});

    await expect(reportStripeUsage()).resolves.toMatchObject({ reported: 1, reports: 1, unknown: 0 });

    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(2);
    const [[firstCall, firstOptions], [secondCall, secondOptions]] = dependencies.createMeterEvent.mock.calls;
    expect(secondCall.identifier).toBe(firstCall.identifier);
    expect(secondOptions).toEqual(firstOptions);
    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    expect(report).toMatchObject({ status: "reported", attemptCount: 2 });
  });

  it("keeps a persistently rate-limited aggregate retryable for the next run", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockRejectedValue(new StripeError({ type: "StripeRateLimitError", statusCode: 429, code: "rate_limit" }));

    await expect(reportStripeUsage()).resolves.toMatchObject({ reported: 0, retrying: 1, unknown: 0 });

    let [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    let [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(report).toMatchObject({ status: "failed", claimedAt: null, lastErrorCode: "rate_limit", attemptCount: 3 });
    expect(report.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(job.status).toBe("processing");

    // The next hourly run resends the same aggregate and closes it.
    await db.update(stripeUsageReports).set({ nextAttemptAt: new Date(Date.now() - 1_000) }).where(eq(stripeUsageReports.id, report.id));
    dependencies.createMeterEvent.mockReset();
    dependencies.createMeterEvent.mockResolvedValue({});
    await expect(reportStripeUsage()).resolves.toMatchObject({ reported: 1, reports: 1 });
    [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.id, report.id));
    [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(report.status).toBe("reported");
    expect(job.status).toBe("reported");
    expect(dependencies.createMeterEvent).toHaveBeenCalledWith(expect.objectContaining({ identifier: report.stripeIdentifier }), { idempotencyKey: report.stripeIdentifier });
  });

  it("stops before a Stripe call when the Lambda is out of time and leaves no claim behind", async () => {
    const context = await seedUsageJob();

    await expect(reportStripeUsage(undefined, { getRemainingTimeInMillis: () => 20_000 })).resolves.toMatchObject({ reported: 0, reports: 0 });

    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    expect(report).toMatchObject({ status: "pending", claimedAt: null, attemptCount: 0 });
  });

  it("resends a recent stale aggregate claim with its original identifier", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockResolvedValue({});
    await reportStripeUsage(undefined, { getRemainingTimeInMillis: () => 20_000 });
    const [pending] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    await db.update(stripeUsageReports).set({
      status: "processing",
      claimedAt: new Date(Date.now() - 16 * 60_000),
      firstAttemptedAt: new Date(Date.now() - 16 * 60_000),
      attemptCount: 1,
    }).where(eq(stripeUsageReports.id, pending.id));

    await expect(reportStripeUsage()).resolves.toMatchObject({ reported: 1, reports: 1 });

    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1);
    expect(dependencies.createMeterEvent.mock.calls[0][0].identifier).toBe(pending.stripeIdentifier);
  });

  it("marks an ambiguous provider failure unknown without changing local reported usage", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockRejectedValue(new Error("network outcome unknown"));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    const [month] = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
    const [ledger] = await db.select().from(usageLedger).where(eq(usageLedger.messageId, context.messageId));
    expect(report).toMatchObject({ attemptCount: 1, claimedAt: null, status: "unknown" });
    expect(job).toMatchObject({ claimedAt: null, status: "unknown" });
    expect(month.stripeReportedEmails).toBe(0);
    expect(ledger.stripeReportedAt).toBeNull();
    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1);
  });

  it("marks a definitive Stripe validation error unreportable", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockRejectedValue(new StripeError({ type: "StripeInvalidRequestError", statusCode: 400, code: "resource_missing" }));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(job).toMatchObject({ status: "unreportable", lastErrorCode: "resource_missing" });
  });

  it("keeps every aggregate pending when Stripe rejects the credentials", async () => {
    await seedUsageJob();
    await seedUsageJob();
    dependencies.createMeterEvent.mockRejectedValue(new StripeError({ type: "StripeAuthenticationError", statusCode: 401 }));

    await expect(reportStripeUsage()).rejects.toThrow("Stripe configuration");

    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1);
    const reports = await db.select().from(stripeUsageReports);
    expect(reports.map((report) => report.status).sort()).toEqual(["failed", "pending"]);
    const open = await db.select().from(stripeUsageReportJobs).where(inArray(stripeUsageReportJobs.status, ["unknown", "unreportable", "reported"]));
    expect(open).toHaveLength(0);
  });

  it("reclassifies a stale legacy processing claim within its workspace", async () => {
    const context = await seedUsageJob();
    await db.update(stripeUsageReportJobs).set({
      status: "processing",
      claimedAt: new Date(Date.now() - 16 * 60_000),
    }).where(eq(stripeUsageReportJobs.id, context.job.id));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [job] = await db.select().from(stripeUsageReportJobs)
      .where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(job).toMatchObject({
      claimedAt: null,
      lastErrorCode: "stale_submission_outcome_unknown",
      status: "unknown",
      workspaceId: context.workspaceId,
    });
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("marks an expired meter event unreportable within its workspace", async () => {
    const context = await seedUsageJob(new Date(Date.now() - 36 * 864e5));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [job] = await db.select().from(stripeUsageReportJobs)
      .where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(job).toMatchObject({
      claimedAt: null,
      lastErrorCode: "meter_timestamp_too_old",
      status: "unreportable",
      workspaceId: context.workspaceId,
    });
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("cannot commit accounting after its aggregate claim was reclassified unknown", async () => {
    const context = await seedUsageJob();
    let releaseStripe!: (value: unknown) => void;
    dependencies.createMeterEvent.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStripe = resolve;
    }));

    const reporting = reportStripeUsage();
    await vi.waitFor(() => expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1));
    await db.update(stripeUsageReports).set({
      status: "unknown",
      claimedAt: null,
      lastErrorCode: "stale_submission_outcome_unknown",
    }).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    releaseStripe({});

    await expect(reporting).rejects.toThrow("ambiguous or unreportable");
    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    const [month] = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
    const [ledger] = await db.select().from(usageLedger).where(eq(usageLedger.messageId, context.messageId));
    const reportedJobs = await db.select().from(stripeUsageReportJobs).where(and(
      eq(stripeUsageReportJobs.workspaceId, context.workspaceId),
      eq(stripeUsageReportJobs.status, "reported"),
    ));
    expect(report).toMatchObject({ status: "unknown", lastErrorCode: "stale_submission_outcome_unknown" });
    expect(reportedJobs).toHaveLength(0);
    expect(month.stripeReportedEmails).toBe(0);
    expect(ledger.stripeReportedAt).toBeNull();
  });

  it("closes an aggregate that is older than the safe resend window as unknown", async () => {
    const context = await seedUsageJob();
    await reportStripeUsage(undefined, { getRemainingTimeInMillis: () => 20_000 });
    await db.update(stripeUsageReports).set({
      status: "failed",
      firstAttemptedAt: new Date(Date.now() - 21 * 3600_000),
    }).where(eq(stripeUsageReports.workspaceId, context.workspaceId));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(job.status).toBe("unknown");
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("refuses to run without the Stripe usage secret", async () => {
    delete process.env.STRIPE_USAGE_SECRET_KEY;
    await expect(reportStripeUsage()).rejects.toThrow("not configured");
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("closes a pending aggregate whose meter timestamp aged past the Stripe limit", async () => {
    const context = await seedUsageJob();
    await reportStripeUsage(undefined, { getRemainingTimeInMillis: () => 20_000 });
    await db.update(stripeUsageReports).set({ eventTimestamp: new Date(Date.now() - 36 * 864e5) })
      .where(eq(stripeUsageReports.workspaceId, context.workspaceId));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(report).toMatchObject({ status: "unreportable", lastErrorCode: "meter_timestamp_too_old" });
    expect(job).toMatchObject({ status: "unreportable", lastErrorCode: "meter_timestamp_too_old" });
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("marks the aggregate unknown, never resent, when local accounting fails after Stripe accepted it", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockResolvedValue({});
    const transaction = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("connection lost"));
    try {
      await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");
    } finally {
      transaction.mockRestore();
    }
    const [report] = await db.select().from(stripeUsageReports).where(eq(stripeUsageReports.workspaceId, context.workspaceId));
    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    expect(report).toMatchObject({ status: "unknown", lastErrorCode: "database_commit_after_stripe_failed", claimedAt: null });
    expect(job).toMatchObject({ status: "unknown", lastErrorCode: "database_commit_after_stripe_failed" });
    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1);
  });

  it("stops between aggregates when the Lambda runs out of time", async () => {
    await seedUsageJob();
    await seedUsageJob();
    dependencies.createMeterEvent.mockResolvedValue({});
    let calls = 0;
    const context = { getRemainingTimeInMillis: () => (++calls <= 2 ? 120_000 : 20_000) };

    await expect(reportStripeUsage(undefined, context)).resolves.toMatchObject({ reported: 1, reports: 1 });

    expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1);
    const reports = await db.select().from(stripeUsageReports);
    expect(reports.map((report) => report.status).sort()).toEqual(["pending", "reported"]);
  });
});

describe("Stripe usage error classification", () => {
  it("retries only failures that cannot double count", () => {
    expect(classifyStripeUsageError(new StripeError({ type: "StripeRateLimitError", statusCode: 429 }))).toBe("retryable");
    expect(classifyStripeUsageError(new StripeError({ type: "StripeAPIError", statusCode: 503 }))).toBe("retryable");
    expect(classifyStripeUsageError(new StripeError({ type: "StripeConnectionError" }))).toBe("retryable");
    expect(classifyStripeUsageError(new StripeError({ type: "StripeInvalidRequestError", statusCode: 409, code: "lock_timeout" }))).toBe("retryable");
    expect(classifyStripeUsageError(new StripeError({ type: "StripeIdempotencyError", statusCode: 400 }))).toBe("ambiguous");
    expect(classifyStripeUsageError(new StripeError({ type: "StripePermissionError", statusCode: 403 }))).toBe("configuration");
    expect(classifyStripeUsageError(new StripeError({ type: "StripeInvalidRequestError", statusCode: 400 }))).toBe("rejected");
    expect(classifyStripeUsageError(new Error("socket hang up"))).toBe("ambiguous");
    expect(classifyStripeUsageError(new StripeError({ type: "StripeError" }))).toBe("ambiguous");
  });
});
