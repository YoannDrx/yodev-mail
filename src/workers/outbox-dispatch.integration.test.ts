import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-sqs", async original => ({
  ...await original<typeof import("@aws-sdk/client-sqs")>(),
  SQSClient: class { send = send; },
}));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: async () => {} }));

import { databasePool, requireDb } from "@/db/runtime";
import { outboxJobs, workspaces } from "@/db/schema";
import { dispatchPendingOutbox } from "./outbox-dispatch";

const db = requireDb();
let workspaceId: string;
beforeEach(async () => {
  workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "Outbox test", slug: workspaceId });
  send.mockReset().mockResolvedValue({ MessageId: "synthetic-sqs-id" });
  vi.stubEnv("EMAIL_QUEUE_URL", "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic-email");
  vi.stubEnv("WEBHOOK_QUEUE_URL", "https://sqs.eu-west-3.amazonaws.com/123456789012/synthetic-webhook");
});
afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  vi.unstubAllEnvs();
});
afterAll(async () => { await databasePool!.end(); });

async function seed(kind = "email", availableAt = new Date(Date.now() - 60_000)) {
  // PostgreSQL now() has sub-millisecond precision; due jobs must not depend
  // on the insert completing in a different JavaScript clock tick.
  const [job] = await db.insert(outboxJobs).values({ workspaceId, kind, aggregateId: randomUUID(), availableAt }).returning();
  return job;
}
async function read(id: string) {
  return (await db.select().from(outboxJobs).where(and(eq(outboxJobs.workspaceId, workspaceId), eq(outboxJobs.id, id))))[0];
}

describe("outbox workspace contracts", () => {
  it("leaves future jobs pending without publishing them", async () => {
    const job = await seed("email", new Date(Date.now() + 60_000));
    expect(await dispatchPendingOutbox()).toEqual({ delivered: 0, scanned: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await read(job.id)).toMatchObject({ status: "pending", attempts: 0, claimedAt: null });
  });
  it("publishes only scoped IDs and never republishes a delivered outbox job", async () => {
    const job = await seed();
    expect(await dispatchPendingOutbox()).toEqual({ delivered: 1, scanned: 1 });
    expect(JSON.parse(send.mock.calls[0][0].input.MessageBody)).toEqual({ workspaceId, messageId: job.aggregateId });
    expect(await read(job.id)).toMatchObject({ status: "delivered", attempts: 1, lastError: null });
    expect(await dispatchPendingOutbox()).toEqual({ delivered: 0, scanned: 0 });
    expect(send).toHaveBeenCalledOnce();
  });
  it("publishes scoped webhook identifiers", async () => {
    const job = await seed("webhook");
    await dispatchPendingOutbox();
    expect(JSON.parse(send.mock.calls[0][0].input.MessageBody)).toEqual({ workspaceId, deliveryId: job.aggregateId });
  });
  it("records a fixed diagnostic on failure and keeps the job retryable", async () => {
    const job = await seed();
    send.mockRejectedValue(new Error("private@example.test with private payload"));
    expect(await dispatchPendingOutbox()).toEqual({ delivered: 0, scanned: 1 });
    expect(await read(job.id)).toMatchObject({ status: "pending", attempts: 1, lastError: "outbox_dispatch_failed", deliveredAt: null });
  });
  it("recovers a stale claim with the same scoped identifiers", async () => {
    const job = await seed();
    await db.update(outboxJobs).set({ status: "processing", claimedAt: new Date(Date.now() - 6 * 60_000) }).where(and(eq(outboxJobs.id, job.id), eq(outboxJobs.workspaceId, workspaceId)));
    expect(await dispatchPendingOutbox()).toEqual({ delivered: 1, scanned: 1 });
    expect(JSON.parse(send.mock.calls[0][0].input.MessageBody)).toEqual({ workspaceId, messageId: job.aggregateId });
  });
  it("does not steal a fresh concurrent claim", async () => {
    await seed();
    let entered!: () => void;
    let release!: () => void;
    const active = new Promise<void>(resolve => { entered = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    send.mockImplementation(async () => { entered(); await resume; return { MessageId: "synthetic-sqs-id" }; });
    const first = dispatchPendingOutbox();
    try {
      await active;
      expect(await dispatchPendingOutbox()).toEqual({ delivered: 0, scanned: 0 });
      expect(send).toHaveBeenCalledOnce();
    } finally { release(); await first; }
  });
});
