import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const metric = vi.hoisted(() => vi.fn());
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: async () => {} }));
vi.mock("@/lib/operational-metric", () => ({ emitOperationalMetric: metric }));

import { databasePool, requireDb } from "@/db/runtime";
import { attachments, domains, emailEvents, idempotencyKeys, messages, outboxJobs, suppressions, usageLedger, workspaces } from "@/db/schema";
import { workspaceReadinessSql } from "@/features/operations/readiness-query";
import { handler, purgeWorkspaceRetention } from "./purge-retention";

const db = requireDb();
const fixtureIds: string[] = [];
const now = new Date("2026-09-15T12:00:00Z");
const old = new Date(now.getTime() - 91 * 864e5);

async function workspace() {
  const id = randomUUID();
  fixtureIds.push(id);
  await db.insert(workspaces).values({ id, name: "Retention fixture", slug: id });
  return id;
}
async function fixture(workspaceId: string, count = 1) {
  const [domain] = await db.insert(domains).values({ workspaceId, name: `${randomUUID()}.example.test` }).returning();
  const rows = await db.insert(messages).values(Array.from({ length: count }, () => ({
    workspaceId, domainId: domain.id, stream: "transactional" as const, status: "delivered" as const,
    fromEmail: "sender@example.test", toEmail: "recipient@example.test", subject: "Private fixture",
    html: "<p>Private fixture</p>", plainText: "Private fixture", queuedAt: old,
    contentExpiresAt: new Date(now.getTime() - 1), providerAcceptedAt: old,
    lastError: "Legacy private diagnostic", tags: { referenceId: "private-reference" },
  }))).returning();
  for (const row of rows) {
    await db.insert(usageLedger).values({ workspaceId, messageId: row.id, acceptedAt: old });
    await db.insert(emailEvents).values({ workspaceId, messageId: row.id, externalEventId: row.id, type: "email.delivered", occurredAt: old, payload: {} });
    await db.insert(suppressions).values({ workspaceId, normalizedEmail: "recipient@example.test", emailHash: row.id, reason: "hard_bounce", createdAt: old });
    await db.insert(idempotencyKeys).values({ workspaceId, key: row.id, requestHash: row.id, response: { ids: [row.id] }, createdAt: old });
    await db.insert(outboxJobs).values({ workspaceId, kind: "email", aggregateId: row.id, status: "delivered", updatedAt: old });
  }
  return rows;
}
afterEach(async () => {
  if (fixtureIds.length) await db.delete(workspaces).where(inArray(workspaces.id, fixtureIds.splice(0)));
  metric.mockClear();
});
afterAll(async () => { await databasePool!.end(); });

describe("bounded retention and tenant isolation", () => {
  it("exposes retention backlog in the scoped GO audit and clears body counters after purging", async () => {
    const id = await workspace();
    await fixture(id);
    await db.update(messages).set({ contentExpiresAt: new Date(Date.now() - 1000) }).where(eq(messages.workspaceId, id));
    await db.insert(attachments).values({
      workspaceId: id, fileName: "fixture.txt", declaredContentType: "text/plain", sizeBytes: 1,
      expectedSha256: "0".repeat(64), storageKey: `pending/${randomUUID()}`, status: "clean", expiresAt: old,
    });
    expect((await databasePool!.query(workspaceReadinessSql, [id])).rows[0]).toMatchObject({ expired_bodies: "1", unredacted_old_messages: "1", expired_attachments: "1" });
    expect((await databasePool!.query(workspaceReadinessSql, [randomUUID()])).rows[0]).toMatchObject({ expired_bodies: "0", unredacted_old_messages: "0", expired_attachments: "0" });
    await purgeWorkspaceRetention(id, new Date());
    expect((await databasePool!.query(workspaceReadinessSql, [id])).rows[0]).toMatchObject({ expired_bodies: "0", unredacted_old_messages: "0", expired_attachments: "1" });
  });
  it("purges only workspace A, preserves its billing ledger and suppression hashes, and is reentrant", async () => {
    const a = await workspace();
    const b = await workspace();
    await fixture(a);
    await fixture(b);
    expect(await purgeWorkspaceRetention(a, now)).toEqual({ expiredBodies: 1, deletedEvents: 1, anonymizedMessages: 1, anonymizedSuppressions: 1, deletedIdempotencyKeys: 1, deletedOutboxJobs: 1 });
    expect((await db.select().from(messages).where(eq(messages.workspaceId, a)))[0]).toMatchObject({ toEmail: "redacted@yodev.invalid", html: "", lastError: null, tags: {} });
    expect((await db.select().from(suppressions).where(eq(suppressions.workspaceId, a)))[0]).toMatchObject({ normalizedEmail: null, emailHash: expect.any(String) });
    expect(await db.select().from(usageLedger).where(eq(usageLedger.workspaceId, a))).toHaveLength(1);
    expect((await db.select().from(messages).where(eq(messages.workspaceId, b)))[0].html).toBe("<p>Private fixture</p>");
    for (const table of [emailEvents, suppressions, idempotencyKeys, outboxJobs]) {
      expect(await db.select().from(table).where(eq(table.workspaceId, b))).toHaveLength(1);
    }
    expect(Object.values(await purgeWorkspaceRetention(a, now))).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("bounds every category and drains the remainder on the next pass", async () => {
    const id = await workspace();
    await fixture(id, 3);
    expect(Object.values(await purgeWorkspaceRetention(id, now, 2))).toEqual([2, 2, 2, 2, 2, 2]);
    expect(Object.values(await purgeWorkspaceRetention(id, now, 2))).toEqual([1, 1, 1, 1, 1, 1]);
  });
  it("keeps unexpired bodies, exact 90-day metadata and undelivered jobs", async () => {
    const id = await workspace();
    const [message] = await fixture(id);
    const boundary = new Date(now.getTime() - 90 * 864e5);
    await db.update(messages).set({ queuedAt: boundary, contentExpiresAt: new Date(now.getTime() + 1) }).where(and(eq(messages.workspaceId, id), eq(messages.id, message.id)));
    await db.update(outboxJobs).set({ status: "pending" }).where(eq(outboxJobs.workspaceId, id));
    expect(await purgeWorkspaceRetention(id, now)).toMatchObject({ expiredBodies: 0, anonymizedMessages: 0, deletedOutboxJobs: 0 });
    expect((await db.select().from(messages).where(eq(messages.workspaceId, id)))[0].html).toBe("<p>Private fixture</p>");
  });
  it("does not process a workspace near the Lambda deadline", async () => {
    const id = await workspace();
    expect(await handler({}, { getRemainingTimeInMillis: () => 19_999 })).toMatchObject({ checked: 0 });
    expect((await db.select().from(workspaces).where(eq(workspaces.id, id)))[0].retentionAttemptedAt).toBeNull();
    expect(metric).toHaveBeenCalledWith("RetentionPurgeBacklog", 1);
  });
  it("rotates across more than one batch of workspaces, including paused and soft-deleted ones", async () => {
    const ids = await Promise.all(Array.from({ length: 55 }, workspace));
    await db.update(workspaces).set({ status: "paused", deletedAt: old }).where(inArray(workspaces.id, ids));
    await handler();
    await handler();
    const rows = await db.select().from(workspaces).where(inArray(workspaces.id, ids));
    expect(rows.every(row => row.retentionAttemptedAt instanceof Date)).toBe(true);
    expect(metric).toHaveBeenCalledWith("RetentionPurgeCompleted");
  });
  it("handles overlapping sweeps without deleting ledger rows", async () => {
    const id = await workspace();
    await fixture(id, 3);
    await Promise.all([purgeWorkspaceRetention(id, now, 2), purgeWorkspaceRetention(id, now, 2)]);
    await purgeWorkspaceRetention(id, now);
    expect(await db.select().from(usageLedger).where(eq(usageLedger.workspaceId, id))).toHaveLength(3);
    expect(Object.values(await purgeWorkspaceRetention(id, now))).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it("advances a failed workspace without emitting raw database diagnostics", async () => {
    const id = await workspace();
    const spy = vi.spyOn(db, "transaction").mockRejectedValueOnce(new Error("private@example.test body"));
    try {
      expect(await handler()).toMatchObject({ failed: 1 });
      expect((await db.select().from(workspaces).where(eq(workspaces.id, id)))[0].retentionAttemptedAt).toBeInstanceOf(Date);
      expect(metric).toHaveBeenCalledWith("RetentionPurgeFailure", 1);
      expect(JSON.stringify(metric.mock.calls)).not.toContain("private@example.test");
    } finally { spy.mockRestore(); }
  });
  it("rejects unscoped IDs and unsafe batch sizes before any mutation", async () => {
    await expect(purgeWorkspaceRetention("", now)).rejects.toThrow();
    await expect(purgeWorkspaceRetention(randomUUID(), now, 101)).rejects.toThrow();
  });
});
