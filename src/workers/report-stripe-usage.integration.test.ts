import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
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

import { databasePool, requireDb } from "@/db/runtime";
import {
  domains,
  messages,
  stripeUsageReportJobs,
  transactionalProfiles,
  usageLedger,
  usageMonths,
  workspaces,
} from "@/db/schema";
import { handler as reportStripeUsage } from "@/workers/report-stripe-usage";

const db = requireDb();
const pool = databasePool!;

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

async function seedUsageJob() {
  const workspaceId = randomUUID();
  const domainId = randomUUID();
  const profileId = randomUUID();
  const messageId = randomUUID();
  const acceptedAt = new Date();
  const month = acceptedAt.toISOString().slice(0, 7);
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Stripe usage integration",
    slug: `stripe-${workspaceId.slice(0, 8)}`,
    status: "approved",
  });
  await db.insert(domains).values({
    id: domainId,
    workspaceId,
    name: "example.com",
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

    await expect(reportStripeUsage()).resolves.toEqual({ reported: 0, disabled: true, unknown: 0 });

    expect(dependencies.loadRuntimeSecrets).not.toHaveBeenCalled();
    expect(dependencies.createMeterEvent).not.toHaveBeenCalled();
  });

  it("reports exactly one meter event and commits all local accounting markers", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockResolvedValue({ identifier: context.job.stripeIdentifier });

    await expect(reportStripeUsage()).resolves.toEqual({ reported: 1, disabled: false, unknown: 0 });

    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    const [month] = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
    const [ledger] = await db.select().from(usageLedger).where(eq(usageLedger.messageId, context.messageId));
    expect(job).toMatchObject({ attemptCount: 1, claimedAt: null, status: "reported" });
    expect(job.reportedAt).toBeInstanceOf(Date);
    expect(month.stripeReportedEmails).toBe(1);
    expect(ledger.stripeReportedAt).toBeInstanceOf(Date);
    expect(dependencies.createMeterEvent).toHaveBeenCalledWith(expect.objectContaining({
      event_name: "yodev_mail_emails_sent",
      identifier: context.job.stripeIdentifier,
      payload: { stripe_customer_id: "cus_integration", value: "1" },
    }));
  });

  it("marks a provider failure unknown without changing local reported usage", async () => {
    const context = await seedUsageJob();
    dependencies.createMeterEvent.mockRejectedValue(new Error("network outcome unknown"));

    await expect(reportStripeUsage()).rejects.toThrow("ambiguous or unreportable");

    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    const [month] = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
    const [ledger] = await db.select().from(usageLedger).where(eq(usageLedger.messageId, context.messageId));
    expect(job).toMatchObject({ attemptCount: 1, claimedAt: null, status: "unknown" });
    expect(month.stripeReportedEmails).toBe(0);
    expect(ledger.stripeReportedAt).toBeNull();
  });

  it("cannot commit accounting after its claim was reclassified unknown", async () => {
    const context = await seedUsageJob();
    let releaseStripe!: (value: unknown) => void;
    dependencies.createMeterEvent.mockImplementationOnce(() => new Promise((resolve) => {
      releaseStripe = resolve;
    }));

    const reporting = reportStripeUsage();
    await vi.waitFor(() => expect(dependencies.createMeterEvent).toHaveBeenCalledTimes(1));
    await db.update(stripeUsageReportJobs).set({
      status: "unknown",
      claimedAt: null,
      lastErrorCode: "stale_submission_outcome_unknown",
    }).where(eq(stripeUsageReportJobs.id, context.job.id));
    releaseStripe({ identifier: context.job.stripeIdentifier });

    await expect(reporting).rejects.toThrow("ambiguous or unreportable");
    const [job] = await db.select().from(stripeUsageReportJobs).where(eq(stripeUsageReportJobs.id, context.job.id));
    const [month] = await db.select().from(usageMonths).where(eq(usageMonths.workspaceId, context.workspaceId));
    const [ledger] = await db.select().from(usageLedger).where(eq(usageLedger.messageId, context.messageId));
    expect(job).toMatchObject({ status: "unknown", lastErrorCode: "stale_submission_outcome_unknown" });
    expect(month.stripeReportedEmails).toBe(0);
    expect(ledger.stripeReportedAt).toBeNull();
  });
});
