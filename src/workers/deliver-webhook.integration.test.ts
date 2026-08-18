import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  emitOperationalMetric: vi.fn(),
  loadRuntimeSecrets: vi.fn(),
  logWorkerResult: vi.fn(),
  postWebhookSafely: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/features/webhooks/safe-http", () => ({
  postWebhookSafely: dependencies.postWebhookSafely,
}));
vi.mock("@/features/webhooks/validate-url", () => ({
  validateWebhookUrl: vi.fn(async (url: string) => url),
}));
vi.mock("@/lib/operational-metric", () => ({
  emitOperationalMetric: dependencies.emitOperationalMetric,
}));
vi.mock("@/lib/worker-log", () => ({
  logWorkerResult: dependencies.logWorkerResult,
}));
vi.mock("@/workers/runtime-secrets", () => ({
  loadRuntimeSecrets: dependencies.loadRuntimeSecrets,
}));

import { databasePool, requireDb } from "@/db/runtime";
import {
  domains,
  emailEvents,
  messages,
  outboxJobs,
  transactionalProfiles,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";
import { encryptSecret, sha256 } from "@/lib/crypto";
import { deliverWebhook } from "@/workers/deliver-webhook";

const db = requireDb();
const pool = databasePool!;
const encryptionKey = "integration-webhook-encryption-key";

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

async function seedDelivery(input: { attempt?: number; enabled?: boolean } = {}) {
  const workspaceId = randomUUID();
  const domainId = randomUUID();
  const profileId = randomUUID();
  const messageId = randomUUID();
  await db.insert(workspaces).values({
    id: workspaceId,
    name: "Webhook integration",
    slug: `webhook-${workspaceId.slice(0, 8)}`,
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
  });
  const [event] = await db.insert(emailEvents).values({
    workspaceId,
    messageId,
    externalEventId: `integration:${randomUUID()}`,
    provider: "postmark",
    type: "email.sent",
    occurredAt: new Date(),
    payload: {},
  }).returning();
  const signingSecret = "integration-signing-secret";
  const [endpoint] = await db.insert(webhookEndpoints).values({
    workspaceId,
    url: "https://webhook.example.test/yodev-mail",
    signingSecretHash: sha256(signingSecret),
    signingSecretEncrypted: encryptSecret(signingSecret, encryptionKey),
    eventTypes: ["email.sent"],
    enabled: input.enabled ?? true,
  }).returning();
  const [delivery] = await db.insert(webhookDeliveries).values({
    workspaceId,
    endpointId: endpoint.id,
    eventId: event.id,
    attempt: input.attempt ?? 0,
    nextAttemptAt: new Date("2026-08-18T17:00:00.000Z"),
  }).returning();
  return delivery;
}

beforeEach(async () => {
  await cleanDatabase();
  dependencies.emitOperationalMetric.mockReset();
  dependencies.loadRuntimeSecrets.mockReset();
  dependencies.logWorkerResult.mockReset();
  dependencies.postWebhookSafely.mockReset();
  process.env.WEBHOOK_SIGNING_SECRET = encryptionKey;
});

afterAll(async () => {
  delete process.env.WEBHOOK_SIGNING_SECRET;
  await pool.end();
});

describe("customer webhook delivery state machine", () => {
  it("records a successful signed delivery", async () => {
    const delivery = await seedDelivery();
    dependencies.postWebhookSafely.mockResolvedValue(204);
    const now = new Date("2026-08-18T18:00:00.000Z");

    await deliverWebhook(delivery.id, now);

    const [stored] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    expect(stored).toMatchObject({ attempt: 1, deliveredAt: now, lastError: null, statusCode: 204 });
    expect(dependencies.postWebhookSafely).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.not.stringContaining("recipient@example.net"),
      headers: expect.objectContaining({
        "x-yodev-mail-signature": expect.any(String),
        "x-yodev-mail-timestamp": String(Math.floor(now.getTime() / 1_000)),
      }),
    }));
  });

  it("schedules one durable retry for an expected HTTP failure", async () => {
    const delivery = await seedDelivery();
    dependencies.postWebhookSafely.mockResolvedValue(503);

    await deliverWebhook(delivery.id, new Date("2026-08-18T18:00:00.000Z"));

    const [stored] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    const jobs = await db.select().from(outboxJobs);
    expect(stored).toMatchObject({ attempt: 1, claimedAt: null, lastError: "http_503", statusCode: 503 });
    expect(stored.nextAttemptAt).toBeInstanceOf(Date);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ aggregateId: delivery.id, kind: "webhook" });
  });

  it("marks the eighth failed attempt terminal without another outbox job", async () => {
    const delivery = await seedDelivery({ attempt: 7 });
    dependencies.postWebhookSafely.mockResolvedValue(500);

    await deliverWebhook(delivery.id, new Date("2026-08-18T18:00:00.000Z"));

    const [stored] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    expect(stored).toMatchObject({ attempt: 8, lastError: "http_500", nextAttemptAt: null });
    expect(stored.terminalAt).toBeInstanceOf(Date);
    expect(await db.select().from(outboxJobs)).toHaveLength(0);
    expect(dependencies.emitOperationalMetric).toHaveBeenCalledWith("CustomerWebhookTerminalFailure");
  });

  it("ignores a stale worker response after a newer claim delivered successfully", async () => {
    const delivery = await seedDelivery();
    let releaseFirst!: (status: number) => void;
    dependencies.postWebhookSafely
      .mockImplementationOnce(() => new Promise<number>((resolve) => {
        releaseFirst = resolve;
      }))
      .mockResolvedValueOnce(204);
    const firstClaimAt = new Date("2026-08-18T18:00:00.000Z");
    const secondClaimAt = new Date(firstClaimAt.getTime() + 3 * 60_000);

    const staleDelivery = deliverWebhook(delivery.id, firstClaimAt);
    await vi.waitFor(() => expect(dependencies.postWebhookSafely).toHaveBeenCalledTimes(1));
    await deliverWebhook(delivery.id, secondClaimAt);
    releaseFirst(503);
    await staleDelivery;

    const [stored] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, delivery.id));
    expect(stored).toMatchObject({ attempt: 1, deliveredAt: secondClaimAt, lastError: null, statusCode: 204 });
    expect(await db.select().from(outboxJobs)).toHaveLength(0);
  });

  it("does not call the endpoint after it has been disabled", async () => {
    const delivery = await seedDelivery({ enabled: false });

    await deliverWebhook(delivery.id, new Date("2026-08-18T18:00:00.000Z"));

    expect(dependencies.postWebhookSafely).not.toHaveBeenCalled();
  });
});
