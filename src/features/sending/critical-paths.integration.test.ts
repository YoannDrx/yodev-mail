import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderSendError } from "@/features/providers/types";

const dependencies = vi.hoisted(() => ({
  afterEligibility: undefined as (() => Promise<void>) | undefined,
  apiKey: undefined as
    | { mode: "live"; scopes: string[]; workspaceId: string }
    | undefined,
  enabledFeatures: new Set<string>(),
  loadRuntimeSecrets: vi.fn(),
  logWorkerResult: vi.fn(),
  s3Send: vi.fn(),
  send: vi.fn(),
  stripeEvent: undefined as Stripe.Event | undefined,
  stripeSubscription: undefined as Stripe.Subscription | undefined,
  constructStripeEvent: vi.fn(),
  retrieveStripeSubscription: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/providers/registry", () => ({
  deliveryProvider: () => ({ send: dependencies.send }),
}));
vi.mock("@/features/sending/eligibility", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/sending/eligibility")>();
  return {
    ...original,
    evaluateStoredMessage: async (...args: Parameters<typeof original.evaluateStoredMessage>) => {
      const result = await original.evaluateStoredMessage(...args);
      await dependencies.afterEligibility?.();
      return result;
    },
  };
});
vi.mock("@/features/api/authenticate-api-key", () => ({
  authenticateApiKey: vi.fn(async () => dependencies.apiKey),
}));
vi.mock("@/features/api/rate-limit", () => ({
  consumeWorkspaceRateLimit: vi.fn(async () => ({
    allowed: true,
    limit: 60,
    remaining: 59,
    resetAt: new Date(Date.now() + 60_000),
  })),
}));
vi.mock("@/lib/env", () => ({
  env: {
    AWS_OIDC_AUDIENCE: undefined,
    AWS_REGION: "eu-west-3",
    AWS_ROLE_ARN: undefined,
    STRIPE_PRICE_PLATFORM: "price_platform",
    STRIPE_PRICE_USAGE: "price_usage",
    STRIPE_WEBHOOK_SECRET: "whsec_integration_test",
  },
  isFeatureEnabled: vi.fn((feature: string) => dependencies.enabledFeatures.has(feature)),
}));
vi.mock("@/lib/stripe", () => ({
  stripe: () => ({
    subscriptions: { retrieve: dependencies.retrieveStripeSubscription },
    webhooks: { constructEvent: dependencies.constructStripeEvent },
  }),
}));
vi.mock("@/lib/operational-metric", () => ({
  emitOperationalMetric: vi.fn(),
}));
vi.mock("@/lib/aws", () => ({
  awsClients: vi.fn(async () => ({ s3: { send: dependencies.s3Send } })),
}));
vi.mock("@/lib/worker-log", () => ({
  logWorkerResult: dependencies.logWorkerResult,
}));
vi.mock("@/workers/runtime-secrets", () => ({
  loadRuntimeSecrets: dependencies.loadRuntimeSecrets,
}));

import { POST as sendEmailRoute } from "@/app/v1/emails/route";
import { POST as stripeWebhookRoute } from "@/app/api/stripe/webhook/route";
import { databasePool, requireDb } from "@/db/runtime";
import {
  auditEvents,
  attachments,
  authInvitations,
  authMembers,
  authOrganizations,
  authUsers,
  clientProvisioningRuns,
  domainProviderBindings,
  domains,
  emailEvents,
  messageAttempts,
  messages,
  subscriptions,
  stripeEvents,
  stripeUsageReportJobs,
  suppressions,
  templateVersions,
  templates,
  transactionalProfiles,
  usageDays,
  usageLedger,
  webhookDeliveries,
  webhookEndpoints,
  outboxJobs,
  workspaceProviderAccounts,
  workspaces,
} from "@/db/schema";
import { reconcileAcceptedOwnerInvitation } from "@/features/onboarding/reconcile-owner";
import { reconcilePendingOwnerInvitations } from "@/features/onboarding/reconcile-owner";
import { reconcileOwnerProvisioningRun } from "@/features/onboarding/reconcile-owner";
import { ingestProviderEvent } from "@/features/providers/ingest-event";
import { suppressionHash } from "@/features/email-address/normalization";
import { utcDay } from "@/features/sending/eligibility";
import { handler as sendEmailHandler, sendOne } from "@/workers/send-email";

const db = requireDb();
const pool = databasePool!;

async function cleanDatabase() {
  await pool.query("drop function if exists fail_accepted_attempt() cascade");
  await pool.query("drop function if exists fail_failed_event() cascade");
  await pool.query("drop function if exists fail_retry_attempt() cascade");
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = result.rows
    .map(({ tablename }) => tablename)
    .filter((name) => /^[a-z0-9_]+$/.test(name))
    .map((name) => `\"${name}\"`);
  if (names.length) {
    await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
  }
}

async function seedTransactionalContext(options: {
  dailyLimit?: number;
  domainName?: string;
  reservedEmails?: number;
  withTemplate?: boolean;
} = {}) {
  const workspaceId = randomUUID();
  const domainId = randomUUID();
  const profileId = randomUUID();
  const templateId = randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Integration Workspace",
    slug: `integration-${workspaceId.slice(0, 8)}`,
    status: "approved",
    dailyLimit: options.dailyLimit ?? 50,
  });
  await db.insert(subscriptions).values({
    workspaceId,
    pilotAccessExpiresAt: new Date(Date.now() + 86_400_000),
  });
  await db.insert(domains).values({
    id: domainId,
    workspaceId,
    name: options.domainName ?? "example.com",
    status: "verified",
    dkimStatus: "verified",
    activeProvider: "postmark",
  });
  await db.insert(domainProviderBindings).values({
    workspaceId,
    domainId,
    provider: "postmark",
    status: "verified",
    dkimStatus: "verified",
    isActive: true,
  });
  await db.insert(workspaceProviderAccounts).values({
    workspaceId,
    provider: "postmark",
    status: "ready",
    externalAccountId: "server-123",
    credentialParameterName: "/test/postmark/server-token",
  });
  await db.insert(transactionalProfiles).values({
    id: profileId,
    workspaceId,
    key: "receipt",
    name: "Receipt",
    triggerDescription: "A purchase made by the recipient triggers this message.",
    recipientRelationship: "The recipient is the customer who made the purchase.",
    contentExample: "Purchase receipt",
    status: "approved",
  });
  await db.insert(usageDays).values({
    workspaceId,
    day: utcDay(),
    reservedEmails: options.reservedEmails ?? 0,
  });
  if (options.withTemplate) {
    await db.insert(templates).values({
      id: templateId,
      workspaceId,
      transactionalProfileId: profileId,
      name: "Receipt",
      subject: "Your receipt",
      reviewStatus: "approved",
    });
    await db.insert(templateVersions).values({
      workspaceId,
      templateId,
      version: 1,
      document: { version: 1, blocks: [] },
      html: "<p>Your receipt</p>",
      plainText: "Your receipt",
      createdBy: "integration-test",
    });
  }
  return { domainId, profileId, templateId, workspaceId };
}

async function seedQueuedMessage(context: Awaited<ReturnType<typeof seedTransactionalContext>>) {
  const id = randomUUID();
  await db.insert(messages).values({
    id,
    workspaceId: context.workspaceId,
    domainId: context.domainId,
    transactionalProfileId: context.profileId,
    provider: "postmark",
    contentKind: "template",
    stream: "transactional",
    sendMode: "live",
    status: "queued",
    fromEmail: "sender@example.com",
    toEmail: "recipient@example.net",
    subject: "Receipt",
    html: "<p>Receipt</p>",
    plainText: "Receipt",
  });
  return id;
}

async function seedCleanAttachment(
  context: Awaited<ReturnType<typeof seedTransactionalContext>>,
  messageId: string,
) {
  const [attachment] = await db.insert(attachments).values({
    workspaceId: context.workspaceId,
    messageId,
    fileName: "receipt.pdf",
    declaredContentType: "application/pdf",
    detectedContentType: "application/pdf",
    sizeBytes: 4,
    expectedSha256: "0".repeat(64),
    verifiedSha256: "0".repeat(64),
    storageKey: `clean/${context.workspaceId}/${messageId}/receipt.pdf`,
    status: "clean",
    expiresAt: new Date(Date.now() + 86_400_000),
  }).returning();
  return attachment;
}

async function seedAcceptedOwnerInvitation() {
  const organizationId = randomUUID();
  const invitationId = randomUUID();
  const userId = randomUUID();
  const inviterId = randomUUID();
  const workspaceId = randomUUID();
  await db.insert(authUsers).values([
    { id: inviterId, email: "admin@example.com", name: "Admin", role: "admin" },
    { id: userId, email: "owner@example.com", name: "Owner" },
  ]);
  await db.insert(authOrganizations).values({
    id: organizationId,
    name: "Client",
    slug: `client-${organizationId.slice(0, 8)}`,
  });
  await db.insert(workspaces).values({
    id: workspaceId,
    authOrganizationId: organizationId,
    name: "Client",
    slug: `workspace-${workspaceId.slice(0, 8)}`,
  });
  await db.insert(authInvitations).values({
    id: invitationId,
    organizationId,
    email: "owner@example.com",
    role: "owner",
    status: "accepted",
    expiresAt: new Date(Date.now() + 86_400_000),
    inviterId,
  });
  await db.insert(authMembers).values({
    id: randomUUID(),
    organizationId,
    userId,
    role: "owner",
  });
  const [run] = await db.insert(clientProvisioningRuns).values({
    workspaceId,
    invitationId,
    status: "invitation_sent",
  }).returning({ id: clientProvisioningRuns.id });
  return { invitationId, organizationId, runId: run.id, userId, workspaceId };
}

function emailRequest(input: {
  fromEmail?: string;
  idempotencyKey: string;
  templateId: string;
}) {
  return new Request("https://api.mail.yodev.fr/v1/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      category: "receipt",
      content: { templateId: input.templateId },
      from: { email: input.fromEmail ?? "Sender@EXAMPLE.COM" },
      to: { email: "Recipient@Example.NET" },
    }),
  });
}

function rawEmailRequest(input: { idempotencyKey: string }) {
  return new Request("https://api.mail.yodev.fr/v1/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      category: "receipt",
      content: {
        subject: "Your receipt",
        html: "<p>Your receipt</p>",
        text: "Your receipt",
      },
      from: { email: "sender@example.com" },
      to: { email: "recipient@example.net" },
    }),
  });
}

beforeEach(async () => {
  dependencies.afterEligibility = undefined;
  dependencies.apiKey = undefined;
  dependencies.enabledFeatures.clear();
  dependencies.enabledFeatures.add("LIVE_EMAIL_ACCEPTANCE_ENABLED");
  dependencies.loadRuntimeSecrets.mockReset();
  dependencies.loadRuntimeSecrets.mockResolvedValue(undefined);
  dependencies.logWorkerResult.mockReset();
  dependencies.s3Send.mockReset();
  dependencies.send.mockReset();
  dependencies.constructStripeEvent.mockReset();
  dependencies.retrieveStripeSubscription.mockReset();
  dependencies.stripeEvent = undefined;
  dependencies.stripeSubscription = undefined;
  dependencies.constructStripeEvent.mockImplementation(() => dependencies.stripeEvent);
  dependencies.retrieveStripeSubscription.mockImplementation(async () => dependencies.stripeSubscription);
  delete process.env.ATTACHMENTS_BUCKET_NAME;
  await cleanDatabase();
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

describe("transactional email critical paths", () => {
  it("commits provider acceptance, quota, attempt, ledger and event exactly once", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    const acceptedAt = new Date();
    dependencies.send.mockResolvedValue({
      acceptedAt,
      providerMessageId: "postmark-accepted-1",
    });

    await sendOne(messageId);
    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(and(
      eq(messages.id, messageId),
      eq(messages.workspaceId, context.workspaceId),
    ));
    const [usage] = await db.select().from(usageDays).where(and(
      eq(usageDays.workspaceId, context.workspaceId),
      eq(usageDays.day, utcDay()),
    ));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    const ledger = await db.select().from(usageLedger).where(eq(usageLedger.messageId, messageId));
    const events = await db.select().from(emailEvents).where(eq(emailEvents.messageId, messageId));

    expect(message.status).toBe("sent");
    expect(message.providerMessageId).toBe("postmark-accepted-1");
    expect(usage.reservedEmails).toBe(0);
    expect(usage.acceptedEmails).toBe(1);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["accepted"]);
    expect(ledger).toHaveLength(1);
    expect(events.filter((event) => event.type === "email.sent")).toHaveLength(1);
    expect(dependencies.send).toHaveBeenCalledTimes(1);
  });

  it("uses unknown without double-counting when accepted persistence fails", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockResolvedValue({
      acceptedAt: new Date(),
      providerMessageId: "postmark-accepted-ambiguous",
    });
    await pool.query(`
      create function fail_accepted_attempt() returns trigger language plpgsql as $$
      begin
        if new.status = 'accepted' then
          raise exception 'accepted attempt failure';
        end if;
        return new;
      end $$
    `);
    await pool.query(`
      create trigger fail_accepted_attempt_trigger
      before insert on message_attempts
      for each row execute function fail_accepted_attempt()
    `);

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const ledger = await db.select().from(usageLedger).where(eq(usageLedger.messageId, messageId));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    expect(message.status).toBe("unknown");
    expect(message.providerMessageId).toBeNull();
    expect(usage.reservedEmails).toBe(0);
    expect(usage.acceptedEmails).toBe(0);
    expect(ledger).toHaveLength(0);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["ambiguous"]);
  });

  it("requeues transient provider failures without releasing the reservation", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockRejectedValue(
      new ProviderSendError("Rate limited", "transient", "provider_rate_limited"),
    );

    await expect(sendOne(messageId)).rejects.toThrow("Rate limited");

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    expect(message.status).toBe("queued");
    expect(usage.reservedEmails).toBe(1);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["transient_failure"]);
  });

  it("does not requeue over a state changed during a transient provider failure", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockImplementation(async () => {
      await db.update(messages).set({ status: "failed" }).where(eq(messages.id, messageId));
      throw new ProviderSendError("Rate limited", "transient", "provider_rate_limited");
    });

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    expect(message.status).toBe("failed");
    expect(attempts).toHaveLength(0);
  });

  it("records an ambiguous provider outcome without retry or failed event", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockRejectedValue(
      new ProviderSendError("Timeout", "ambiguous", "provider_timeout"),
    );

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    const failedEvents = await db.select().from(emailEvents).where(and(
      eq(emailEvents.messageId, messageId),
      eq(emailEvents.type, "email.failed"),
    ));
    expect(message.status).toBe("unknown");
    expect(usage.reservedEmails).toBe(0);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["ambiguous"]);
    expect(failedEvents).toHaveLength(0);
  });

  it("keeps a transient provider failure retryable when attempt persistence fails", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockRejectedValue(
      new ProviderSendError("Rate limited", "transient", "provider_rate_limited"),
    );
    await pool.query(`
      create function fail_retry_attempt() returns trigger language plpgsql as $$
      begin
        if new.status = 'retry' then
          raise exception 'retry attempt failure';
        end if;
        return new;
      end $$
    `);
    await pool.query(`
      create trigger fail_retry_attempt_trigger
      before insert on message_attempts
      for each row execute function fail_retry_attempt()
    `);

    await expect(sendOne(messageId)).rejects.toThrow("Failed query");

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    expect(message.status).toBe("queued");
    expect(usage.reservedEmails).toBe(1);
  });

  it("rolls back a terminal transition when its public event fails and allows retry", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockRejectedValue(
      new ProviderSendError("Rejected", "definitive", "provider_rejected"),
    );
    await pool.query(`
      create function fail_failed_event() returns trigger language plpgsql as $$
      begin
        if new.type = 'email.failed' then
          raise exception 'failed event failure';
        end if;
        return new;
      end $$
    `);
    await pool.query(`
      create trigger fail_failed_event_trigger
      before insert on email_events
      for each row execute function fail_failed_event()
    `);

    await expect(sendOne(messageId)).rejects.toThrow("Failed query");
    let [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    let [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    expect(message.status).toBe("queued");
    expect(usage.reservedEmails).toBe(1);

    await pool.query("drop function fail_failed_event() cascade");
    await sendOne(messageId);
    [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const failedEvents = await db.select().from(emailEvents).where(and(
      eq(emailEvents.messageId, messageId),
      eq(emailEvents.type, "email.failed"),
    ));
    expect(message.status).toBe("failed");
    expect(usage.reservedEmails).toBe(0);
    expect(failedEvents).toHaveLength(1);
  });

  it("fails an expired message atomically without calling the provider", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await db.update(messages).set({
      sendDeadlineAt: new Date(Date.now() - 1_000),
    }).where(eq(messages.id, messageId));

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    const events = await db.select().from(emailEvents).where(eq(emailEvents.messageId, messageId));
    expect(message.status).toBe("failed");
    expect(message.lastError).toBe("send_deadline_exceeded");
    expect(usage.reservedEmails).toBe(0);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["definitive_failure"]);
    expect(events.map((event) => event.type)).toContain("email.failed");
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("suppresses a blocked recipient atomically without calling the provider", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await db.insert(suppressions).values({
      workspaceId: context.workspaceId,
      normalizedEmail: "recipient@example.net",
      emailHash: suppressionHash("recipient@example.net"),
      reason: "manual",
    });

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const events = await db.select().from(emailEvents).where(eq(emailEvents.messageId, messageId));
    expect(message.status).toBe("suppressed");
    expect(usage.reservedEmails).toBe(0);
    expect(events.map((event) => event.type)).toContain("email.suppressed");
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("fails atomically when eligibility detects an unavailable provider account", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await db.delete(workspaceProviderAccounts).where(eq(
      workspaceProviderAccounts.workspaceId,
      context.workspaceId,
    ));

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const attempts = await db.select().from(messageAttempts).where(eq(messageAttempts.messageId, messageId));
    expect(message.status).toBe("failed");
    expect(message.lastError).toBe("Le service de livraison du workspace n’est pas prêt.");
    expect(usage.reservedEmails).toBe(0);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["definitive_failure"]);
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("fails safely when the provider account disappears after eligibility", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.afterEligibility = async () => {
      await db.delete(workspaceProviderAccounts).where(eq(
        workspaceProviderAccounts.workspaceId,
        context.workspaceId,
      ));
      dependencies.afterEligibility = undefined;
    };

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    expect(message.status).toBe("failed");
    expect(message.lastError).toBe("Provider account is unavailable.");
    expect(usage.reservedEmails).toBe(0);
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("fails atomically when the queued message has no provider assignment", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await db.update(messages).set({ provider: null }).where(eq(messages.id, messageId));

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    const events = await db.select().from(emailEvents).where(eq(emailEvents.messageId, messageId));
    expect(message.status).toBe("failed");
    expect(message.lastError).toBe("Provider assignment is missing.");
    expect(usage.reservedEmails).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["email.failed"]);
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("fails atomically when clean attachment storage is not configured", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await seedCleanAttachment(context, messageId);

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    expect(message.status).toBe("failed");
    expect(message.lastError).toBe("Attachment storage is not configured.");
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("treats missing attachment bytes as a definitive failure", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await seedCleanAttachment(context, messageId);
    process.env.ATTACHMENTS_BUCKET_NAME = "integration-attachments";
    dependencies.s3Send.mockResolvedValueOnce({ Body: undefined });

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    expect(message.status).toBe("failed");
    expect(message.lastError).toBe("Attachment content is unavailable.");
    expect(dependencies.send).not.toHaveBeenCalled();
  });

  it("loads and purges clean attachments after provider acceptance", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    const attachment = await seedCleanAttachment(context, messageId);
    process.env.ATTACHMENTS_BUCKET_NAME = "integration-attachments";
    dependencies.s3Send
      .mockResolvedValueOnce({
        Body: { transformToByteArray: vi.fn(async () => new Uint8Array([1, 2, 3, 4])) },
      })
      .mockResolvedValueOnce({});
    dependencies.send.mockResolvedValue({
      acceptedAt: new Date(),
      providerMessageId: "postmark-with-attachment",
    });

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const [storedAttachment] = await db.select().from(attachments).where(eq(attachments.id, attachment.id));
    expect(message.status).toBe("sent");
    expect(storedAttachment.status).toBe("deleted");
    expect(storedAttachment.fileName).toBe("[deleted]");
    expect(dependencies.s3Send).toHaveBeenCalledTimes(2);
    expect(dependencies.send).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [expect.objectContaining({ name: "receipt.pdf" })],
    }));
  });

  it("converts an untyped provider exception into an unknown outcome", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockRejectedValue("transport disconnected");

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    expect(message.status).toBe("unknown");
    expect(message.lastError).toBe("provider_unknown");
  });

  it("does not overwrite a state changed after provider acceptance", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockImplementation(async () => {
      await db.update(messages).set({ status: "failed" }).where(eq(messages.id, messageId));
      return { acceptedAt: new Date(), providerMessageId: "postmark-state-race" };
    });

    await sendOne(messageId);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const ledger = await db.select().from(usageLedger).where(eq(usageLedger.messageId, messageId));
    expect(message.status).toBe("failed");
    expect(ledger).toHaveLength(0);
  });

  it("creates one Stripe usage job for a billable accepted message", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    await db.update(subscriptions).set({
      status: "active",
      plan: "beta",
      stripeCustomerId: "cus_yodev",
      stripeSubscriptionId: "sub_yodev",
    }).where(eq(subscriptions.workspaceId, context.workspaceId));
    dependencies.send.mockResolvedValue({
      acceptedAt: new Date(),
      providerMessageId: "postmark-billable",
    });

    await sendOne(messageId);
    await sendOne(messageId);

    const jobs = await db.select().from(stripeUsageReportJobs).where(eq(
      stripeUsageReportJobs.messageId,
      messageId,
    ));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      stripeCustomerId: "cus_yodev",
      stripeSubscriptionId: "sub_yodev",
    });
  });

  it("creates accepted customer webhook delivery only when explicitly enabled", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.enabledFeatures.add("CUSTOMER_WEBHOOKS_ENABLED");
    await db.insert(webhookEndpoints).values({
      workspaceId: context.workspaceId,
      url: "https://webhook.example.test/accepted",
      signingSecretHash: "hash",
      signingSecretEncrypted: "encrypted",
      eventTypes: ["email.sent"],
    });
    dependencies.send.mockResolvedValue({
      acceptedAt: new Date(),
      providerMessageId: "postmark-webhook",
    });

    await sendOne(messageId);

    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "webhook"))).toHaveLength(1);
  });

  it("returns partial SQS batch failures without logging message content", async () => {
    const context = await seedTransactionalContext({ reservedEmails: 1 });
    const messageId = await seedQueuedMessage(context);
    dependencies.send.mockResolvedValue({
      acceptedAt: new Date(),
      providerMessageId: "postmark-batch",
    });

    const result = await sendEmailHandler({
      Records: [
        { body: JSON.stringify({ messageId }), messageId: "sqs-good" },
        { body: "not-json", messageId: "sqs-bad" },
      ],
    } as never);

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "sqs-bad" }] });
    expect(dependencies.loadRuntimeSecrets).toHaveBeenCalledTimes(1);
    expect(dependencies.logWorkerResult).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: "sqs-good",
      outcome: "completed",
    }));
    expect(dependencies.logWorkerResult).toHaveBeenCalledWith(expect.objectContaining({
      correlationId: "sqs-bad",
      outcome: "failed",
    }));
  });

  it("serializes provider events and refuses stale status regression", async () => {
    const context = await seedTransactionalContext();
    const messageId = await seedQueuedMessage(context);
    const deliveredAt = new Date("2026-08-18T10:00:00.000Z");
    await db.update(messages).set({
      status: "sent",
      providerMessageId: "postmark-events-1",
      acceptedAt: new Date("2026-08-18T09:55:00.000Z"),
    }).where(eq(messages.id, messageId));

    await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "delivery-1",
      providerMessageId: "postmark-events-1",
      messageId,
      workspaceId: context.workspaceId,
      type: "delivered",
      occurredAt: deliveredAt,
    });
    const duplicate = await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "delivery-1",
      providerMessageId: "postmark-events-1",
      messageId,
      workspaceId: context.workspaceId,
      type: "delivered",
      occurredAt: deliveredAt,
    });
    await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "failed-old",
      providerMessageId: "postmark-events-1",
      messageId,
      workspaceId: context.workspaceId,
      type: "failed",
      occurredAt: new Date("2026-08-18T09:59:00.000Z"),
    });
    await Promise.all([
      ingestProviderEvent({
        provider: "postmark",
        externalEventId: "hard-bounce-1",
        providerMessageId: "postmark-events-1",
        messageId,
        workspaceId: context.workspaceId,
        type: "hard_bounced",
        occurredAt: new Date("2026-08-18T10:01:00.000Z"),
      }),
      ingestProviderEvent({
        provider: "postmark",
        externalEventId: "complaint-1",
        providerMessageId: "postmark-events-1",
        messageId,
        workspaceId: context.workspaceId,
        type: "complained",
        occurredAt: new Date("2026-08-18T10:02:00.000Z"),
      }),
    ]);

    const [message] = await db.select().from(messages).where(eq(messages.id, messageId));
    const rows = await db.select().from(suppressions).where(eq(suppressions.workspaceId, context.workspaceId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    expect(duplicate.duplicate).toBe(true);
    expect(message.status).toBe("complained");
    expect(message.deliveredAt).toEqual(deliveredAt);
    expect(message.lastEventAt).toEqual(new Date("2026-08-18T10:02:00.000Z"));
    expect(rows).toHaveLength(1);
    expect(usage.deliveredEmails).toBe(1);
  });

  it("keeps provider-event customer webhooks closed until their gate is enabled", async () => {
    const context = await seedTransactionalContext();
    const messageId = await seedQueuedMessage(context);
    await db.update(messages).set({
      status: "sent",
      providerMessageId: "postmark-gated-webhook",
    }).where(eq(messages.id, messageId));
    await db.insert(webhookEndpoints).values({
      workspaceId: context.workspaceId,
      url: "https://webhook.example.test/email",
      signingSecretHash: "hash",
      signingSecretEncrypted: "encrypted",
      eventTypes: ["email.delivered", "email.soft_bounced"],
    });

    await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "gated-delivery",
      providerMessageId: "postmark-gated-webhook",
      messageId,
      workspaceId: context.workspaceId,
      type: "delivered",
      occurredAt: new Date("2026-08-18T11:00:00.000Z"),
    });
    expect(await db.select().from(webhookDeliveries)).toHaveLength(0);

    dependencies.enabledFeatures.add("CUSTOMER_WEBHOOKS_ENABLED");
    await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "enabled-soft-bounce",
      providerMessageId: "postmark-gated-webhook",
      messageId,
      workspaceId: context.workspaceId,
      type: "soft_bounced",
      occurredAt: new Date("2026-08-18T11:01:00.000Z"),
    });

    const deliveries = await db.select().from(webhookDeliveries);
    const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "webhook"));
    expect(deliveries).toHaveLength(1);
    expect(jobs).toHaveLength(1);
  });

  it("locates provider events by provider message id and skips unknown messages", async () => {
    const context = await seedTransactionalContext();
    const messageId = await seedQueuedMessage(context);
    await db.update(messages).set({
      status: "sent",
      providerMessageId: "postmark-fallback-lookup",
    }).where(eq(messages.id, messageId));

    const fallback = await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "fallback-delivery",
      providerMessageId: "postmark-fallback-lookup",
      workspaceId: context.workspaceId,
      type: "delivered",
      occurredAt: new Date(),
      reasonCode: "delivered_by_provider",
    });
    const unknown = await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "unknown-delivery",
      providerMessageId: "postmark-missing",
      workspaceId: context.workspaceId,
      type: "delivered",
      occurredAt: new Date(),
    });

    const [event] = await db.select().from(emailEvents).where(eq(
      emailEvents.externalEventId,
      "fallback-delivery",
    ));
    expect(fallback).toMatchObject({ skipped: false, duplicate: false });
    expect(unknown).toEqual({ skipped: true });
    expect(event.payload).toEqual({ reasonCode: "delivered_by_provider" });
  });

  it("does not auto-pause on a single hard bounce below the reputation threshold", async () => {
    const context = await seedTransactionalContext();
    const messageId = await seedQueuedMessage(context);
    await db.update(messages).set({
      status: "sent",
      providerMessageId: "postmark-one-bounce",
    }).where(eq(messages.id, messageId));
    await db.update(usageDays).set({ acceptedEmails: 51 }).where(eq(
      usageDays.workspaceId,
      context.workspaceId,
    ));

    await ingestProviderEvent({
      provider: "postmark",
      externalEventId: "single-hard-bounce",
      providerMessageId: "postmark-one-bounce",
      messageId,
      workspaceId: context.workspaceId,
      type: "hard_bounced",
      occurredAt: new Date(),
    });

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, context.workspaceId));
    expect(workspace.status).toBe("approved");
  });

  it("reconciles an accepted Better Auth owner exactly once under concurrency", async () => {
    const { invitationId, organizationId, userId, workspaceId } =
      await seedAcceptedOwnerInvitation();

    await Promise.all([
      reconcileAcceptedOwnerInvitation({ invitationId, organizationId, userId, actorUserId: userId }),
      reconcileAcceptedOwnerInvitation({ invitationId, organizationId, userId, actorUserId: userId }),
    ]);

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    const [run] = await db.select().from(clientProvisioningRuns).where(eq(clientProvisioningRuns.workspaceId, workspaceId));
    const audits = await db.select().from(auditEvents).where(and(
      eq(auditEvents.workspaceId, workspaceId),
      eq(auditEvents.action, "client.owner_invitation_accepted"),
    ));
    expect(workspace.authOwnerUserId).toBe(userId);
    expect(run.status).toBe("accepted");
    expect(audits).toHaveLength(1);
  });

  it("repairs accepted owner invitations through the scheduled reconciliation scan", async () => {
    const { workspaceId } = await seedAcceptedOwnerInvitation();

    const first = await reconcilePendingOwnerInvitations();
    const second = await reconcilePendingOwnerInvitations();

    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
    const [run] = await db.select().from(clientProvisioningRuns).where(eq(
      clientProvisioningRuns.workspaceId,
      workspaceId,
    ));
    expect(first).toEqual({ failed: 0, reconciled: 1, scanned: 1 });
    expect(second).toEqual({ failed: 0, reconciled: 0, scanned: 0 });
    expect(workspace.authOwnerUserId).not.toBeNull();
    expect(run.status).toBe("accepted");
  });

  it("skips unknown owner invitations without changing application ownership", async () => {
    const result = await reconcileAcceptedOwnerInvitation({
      invitationId: randomUUID(),
      organizationId: randomUUID(),
      userId: randomUUID(),
      actorUserId: "integration-test",
    });
    expect(result).toEqual({ reconciled: false, skipped: true });
  });

  it("rejects an invitation that Better Auth has not accepted", async () => {
    const context = await seedAcceptedOwnerInvitation();
    await db.update(authInvitations).set({ status: "pending" }).where(eq(
      authInvitations.id,
      context.invitationId,
    ));

    await expect(reconcileAcceptedOwnerInvitation({
      invitationId: context.invitationId,
      organizationId: context.organizationId,
      userId: context.userId,
      actorUserId: context.userId,
    })).rejects.toThrow("not fully accepted");
  });

  it("refuses to replace a different existing workspace owner", async () => {
    const context = await seedAcceptedOwnerInvitation();
    await db.update(workspaces).set({ authOwnerUserId: "another-owner" }).where(eq(
      workspaces.id,
      context.workspaceId,
    ));

    await expect(reconcileAcceptedOwnerInvitation({
      invitationId: context.invitationId,
      organizationId: context.organizationId,
      userId: context.userId,
      actorUserId: context.userId,
    })).rejects.toThrow("already linked to another owner");
  });

  it("records a binding-only reconciliation when the provisioning run is already accepted", async () => {
    const context = await seedAcceptedOwnerInvitation();
    await db.update(clientProvisioningRuns).set({ status: "accepted" }).where(eq(
      clientProvisioningRuns.id,
      context.runId,
    ));

    const result = await reconcileAcceptedOwnerInvitation({
      invitationId: context.invitationId,
      organizationId: context.organizationId,
      userId: context.userId,
      actorUserId: context.userId,
    });

    const [audit] = await db.select().from(auditEvents).where(eq(
      auditEvents.action,
      "client.owner_binding_reconciled",
    ));
    expect(result.reconciled).toBe(true);
    expect(audit.metadata).toMatchObject({ reconciliation: true });
  });

  it("counts an invalid accepted owner candidate as a scheduled reconciliation failure", async () => {
    const context = await seedAcceptedOwnerInvitation();
    await db.update(authMembers).set({ role: "member" }).where(eq(
      authMembers.userId,
      context.userId,
    ));

    await expect(reconcileOwnerProvisioningRun(
      context.runId,
      "integration-test",
    )).rejects.toThrow("No accepted owner invitation");
    await expect(reconcilePendingOwnerInvitations()).resolves.toEqual({
      failed: 1,
      reconciled: 0,
      scanned: 1,
    });
  });

  it("normalizes mailbox domains and enforces idempotence under concurrent API requests", async () => {
    const context = await seedTransactionalContext({ withTemplate: true });
    dependencies.apiKey = {
      mode: "live",
      scopes: ["emails:send"],
      workspaceId: context.workspaceId,
    };

    const [first, second] = await Promise.all([
      sendEmailRoute(emailRequest({ idempotencyKey: "same-request", templateId: context.templateId })),
      sendEmailRoute(emailRequest({ idempotencyKey: "same-request", templateId: context.templateId })),
    ]);
    const firstBody = await first.json() as { data: { id: string } };
    const secondBody = await second.json() as { data: { id: string } };
    const rows = await db.select().from(messages).where(eq(messages.workspaceId, context.workspaceId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(firstBody.data.id).toBe(secondBody.data.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].fromEmail).toBe("sender@example.com");
    expect(rows[0].toEmail).toBe("recipient@example.net");
    expect(usage.reservedEmails).toBe(1);
  });

  it("serializes the daily quota across different idempotency keys", async () => {
    const context = await seedTransactionalContext({ dailyLimit: 1, withTemplate: true });
    dependencies.apiKey = {
      mode: "live",
      scopes: ["emails:send"],
      workspaceId: context.workspaceId,
    };

    const responses = await Promise.all([
      sendEmailRoute(emailRequest({ idempotencyKey: "quota-a", templateId: context.templateId })),
      sendEmailRoute(emailRequest({ idempotencyKey: "quota-b", templateId: context.templateId })),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 429]);
    const rows = await db.select().from(messages).where(eq(messages.workspaceId, context.workspaceId));
    const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, context.workspaceId));
    expect(rows).toHaveLength(1);
    expect(usage.reservedEmails).toBe(1);
  });

  it("refuses a verified domain and template owned by another workspace", async () => {
    const first = await seedTransactionalContext({
      domainName: "tenant-a.example",
      withTemplate: true,
    });
    const second = await seedTransactionalContext({
      domainName: "tenant-b.example",
      withTemplate: true,
    });
    dependencies.apiKey = {
      mode: "live",
      scopes: ["emails:send"],
      workspaceId: first.workspaceId,
    };

    const response = await sendEmailRoute(emailRequest({
      fromEmail: "sender@tenant-b.example",
      idempotencyKey: "cross-tenant",
      templateId: second.templateId,
    }));

    expect(response.status).toBe(403);
    const rows = await db.select().from(messages).where(eq(messages.workspaceId, first.workspaceId));
    expect(rows).toHaveLength(0);
  });

  it("requires the deployment gate, hybrid policy and raw scope together", async () => {
    const context = await seedTransactionalContext();
    dependencies.apiKey = {
      mode: "live",
      scopes: ["emails:send", "emails:send:raw"],
      workspaceId: context.workspaceId,
    };
    await db.update(workspaces).set({ contentPolicy: "hybrid" }).where(eq(
      workspaces.id,
      context.workspaceId,
    ));

    dependencies.enabledFeatures.delete("RAW_EMAIL_ENABLED");
    const closedGate = await sendEmailRoute(rawEmailRequest({ idempotencyKey: "raw-closed-gate" }));
    expect(closedGate.status).toBe(403);

    dependencies.enabledFeatures.add("RAW_EMAIL_ENABLED");
    await db.update(workspaces).set({ contentPolicy: "template_only" }).where(eq(
      workspaces.id,
      context.workspaceId,
    ));
    const templatesOnly = await sendEmailRoute(rawEmailRequest({ idempotencyKey: "raw-templates-only" }));
    expect(templatesOnly.status).toBe(403);

    await db.update(workspaces).set({ contentPolicy: "hybrid" }).where(eq(
      workspaces.id,
      context.workspaceId,
    ));
    dependencies.apiKey = {
      mode: "live",
      scopes: ["emails:send"],
      workspaceId: context.workspaceId,
    };
    const missingScope = await sendEmailRoute(rawEmailRequest({ idempotencyKey: "raw-missing-scope" }));
    expect(missingScope.status).toBe(403);

    dependencies.apiKey = {
      mode: "live",
      scopes: ["emails:send", "emails:send:raw"],
      workspaceId: context.workspaceId,
    };
    const allowed = await sendEmailRoute(rawEmailRequest({ idempotencyKey: "raw-allowed" }));
    const [message] = await db.select().from(messages).where(eq(
      messages.workspaceId,
      context.workspaceId,
    ));

    expect(allowed.status).toBe(202);
    expect(message).toMatchObject({ contentKind: "raw", status: "queued" });
  });

  it("persists and deduplicates a signed Stripe subscription webhook", async () => {
    const context = await seedTransactionalContext();
    const eventId = "evt_integration_subscription";
    const subscriptionId = "sub_integration";
    dependencies.stripeSubscription = {
      id: subscriptionId,
      object: "subscription",
      canceled_at: null,
      customer: "cus_integration",
      livemode: false,
      metadata: {
        workspaceId: context.workspaceId,
        plan: "beta",
        yodev_product: "mail",
      },
      status: "active",
      items: {
        data: [
          {
            current_period_start: 1_786_000_000,
            current_period_end: 1_788_000_000,
            price: { id: "price_platform", recurring: { usage_type: "licensed" } },
            quantity: 1,
          },
          {
            current_period_start: 1_786_000_000,
            current_period_end: 1_788_000_000,
            price: { id: "price_usage", recurring: { usage_type: "metered" } },
            quantity: null,
          },
        ],
      },
    } as unknown as Stripe.Subscription;
    dependencies.stripeEvent = {
      id: eventId,
      object: "event",
      api_version: "2026-06-24.dahlia",
      created: 1_786_000_100,
      data: { object: dependencies.stripeSubscription },
      livemode: false,
      pending_webhooks: 1,
      request: null,
      type: "customer.subscription.updated",
    } as Stripe.Event;

    const request = () => new Request("https://mail.yodev.fr/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "signed" },
      body: "{}",
    });
    const first = await stripeWebhookRoute(request());
    const duplicate = await stripeWebhookRoute(request());

    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, context.workspaceId));
    const events = await db.select().from(stripeEvents).where(eq(stripeEvents.eventId, eventId));
    expect(first.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ duplicate: true });
    expect(subscription.status).toBe("active");
    expect(subscription.stripeSubscriptionId).toBe(subscriptionId);
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("processed");
    expect(dependencies.retrieveStripeSubscription).toHaveBeenCalledTimes(1);
  });
});
