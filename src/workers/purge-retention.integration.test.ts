import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

const metric = vi.hoisted(() => vi.fn());
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: async () => {} }));
vi.mock("@/lib/operational-metric", () => ({ emitOperationalMetric: metric }));

import { databasePool, requireDb } from "@/db/runtime";
import { attachments, auditEvents, betaApplications, domains, emailEvents, idempotencyKeys, messageAttempts, messages, outboxJobs, stripeEvents, suppressions, usageDays, usageLedger, workspaces } from "@/db/schema";
import { workspaceReadinessSql } from "@/features/operations/readiness-query";
import { handler, purgeGlobalRetention, purgeWorkspaceRetention } from "./purge-retention";

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
    await db.insert(messageAttempts).values({ workspaceId, messageId: row.id, attempt: 1, status: "accepted", errorMessage: "Legacy provider text", createdAt: old });
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
    expect(await purgeWorkspaceRetention(a, now)).toEqual({ expiredBodies: 1, deletedEvents: 1, anonymizedMessages: 1, anonymizedSuppressions: 1, deletedIdempotencyKeys: 1, deletedOutboxJobs: 1, deletedMessageAttempts: 1, deletedAuditEvents: 0, deletedUsageDays: 0 });
    expect((await db.select().from(messages).where(eq(messages.workspaceId, a)))[0]).toMatchObject({ toEmail: "redacted@yodev.invalid", html: "", lastError: null, tags: {} });
    expect((await db.select().from(suppressions).where(eq(suppressions.workspaceId, a)))[0]).toMatchObject({ normalizedEmail: null, emailHash: expect.any(String) });
    expect(await db.select().from(usageLedger).where(eq(usageLedger.workspaceId, a))).toHaveLength(1);
    expect((await db.select().from(messages).where(eq(messages.workspaceId, b)))[0].html).toBe("<p>Private fixture</p>");
    for (const table of [emailEvents, suppressions, idempotencyKeys, outboxJobs, messageAttempts]) {
      expect(await db.select().from(table).where(eq(table.workspaceId, b))).toHaveLength(1);
    }
    expect(Object.values(await purgeWorkspaceRetention(a, now))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
  it("bounds every category and drains the remainder on the next pass", async () => {
    const id = await workspace();
    await fixture(id, 3);
    expect(Object.values(await purgeWorkspaceRetention(id, now, 2))).toEqual([2, 2, 2, 2, 2, 2, 2, 0, 0]);
    expect(Object.values(await purgeWorkspaceRetention(id, now, 2))).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0]);
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
    expect(Object.values(await purgeWorkspaceRetention(id, now))).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
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
  it("expires attempts after 90 days, audit events after 13 months and daily usage after 25 months", async () => {
    const a = await workspace();
    const b = await workspace();
    const [message] = await fixture(a);
    await db.insert(messageAttempts).values({ workspaceId: a, messageId: message.id, attempt: 2, status: "accepted", createdAt: new Date(now.getTime() - 89 * 864e5) });
    const months = (count: number) => { const date = new Date(now); date.setUTCMonth(date.getUTCMonth() - count); return date; };
    for (const workspaceId of [a, b]) {
      await db.insert(auditEvents).values([
        { workspaceId, actorUserId: "user", action: "fixture.old", entityType: "workspace", createdAt: months(14) },
        { workspaceId, actorUserId: "user", action: "fixture.recent", entityType: "workspace", createdAt: months(12) },
      ]);
      await db.insert(usageDays).values([
        { workspaceId, day: months(26).toISOString().slice(0, 10), acceptedEmails: 1 },
        { workspaceId, day: months(24).toISOString().slice(0, 10), acceptedEmails: 1 },
      ]);
    }
    expect(await purgeWorkspaceRetention(a, now)).toMatchObject({ deletedMessageAttempts: 1, deletedAuditEvents: 1, deletedUsageDays: 1 });
    expect((await db.select().from(messageAttempts).where(eq(messageAttempts.workspaceId, a))).map(row => row.attempt)).toEqual([2]);
    expect((await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, a))).map(row => row.action)).toEqual(["fixture.recent"]);
    expect(await db.select().from(usageDays).where(eq(usageDays.workspaceId, a))).toHaveLength(1);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, b))).toHaveLength(2);
    expect(await db.select().from(usageDays).where(eq(usageDays.workspaceId, b))).toHaveLength(2);
  });
  it("purges control-plane records in bounded batches: Stripe events, platform audits and beta applications", async () => {
    const tag = randomUUID();
    const days = (count: number) => new Date(now.getTime() - count * 864e5);
    const eventIds = [`evt_old_a_${tag}`, `evt_old_b_${tag}`, `evt_new_${tag}`].map(id => id.slice(0, 64));
    await db.insert(stripeEvents).values([
      { eventId: eventIds[0], type: "invoice.paid", createdAt: days(120) },
      { eventId: eventIds[1], type: "invoice.paid", createdAt: days(100) },
      { eventId: eventIds[2], type: "invoice.paid", createdAt: days(10) },
    ]);
    const audits = await db.insert(auditEvents).values([
      { actorUserId: tag, action: "platform.old", entityType: "platform", createdAt: days(420) },
      { actorUserId: tag, action: "platform.recent", entityType: "platform", createdAt: days(30) },
    ]).returning({ id: auditEvents.id });
    const application = { company: "Fixture", contactName: "Fixture", workEmail: "fixture@example.test", useCase: "Receipts", expectedMonthlyVolume: 100, consentedAt: now };
    const applications = await db.insert(betaApplications).values([
      { ...application, ipHash: `old-${tag}`.slice(0, 64), createdAt: days(400) },
      { ...application, ipHash: `mid-${tag}`.slice(0, 64), createdAt: days(40) },
      { ...application, ipHash: `new-${tag}`.slice(0, 64), createdAt: days(5) },
    ]).returning({ id: betaApplications.id });
    try {
      await expect(purgeGlobalRetention(now, 0)).rejects.toThrow();
      await expect(purgeGlobalRetention(now, 501)).rejects.toThrow();
      // Other suites share the database: drain with a small batch, then inspect only our rows.
      for (let pass = 0; pass < 50; pass++) {
        const result = await purgeGlobalRetention(now, 1);
        if (Object.values(result).every(count => count === 0)) break;
        expect(Object.values(result).every(count => count <= 1)).toBe(true);
      }
      expect((await db.select().from(stripeEvents).where(inArray(stripeEvents.eventId, eventIds))).map(row => row.eventId)).toEqual([eventIds[2]]);
      expect((await db.select().from(auditEvents).where(inArray(auditEvents.id, audits.map(row => row.id)))).map(row => row.action)).toEqual(["platform.recent"]);
      const remaining = await db.select().from(betaApplications).where(inArray(betaApplications.id, applications.map(row => row.id)));
      expect(remaining.map(row => row.ipHash).sort()).toEqual([null, `new-${tag}`.slice(0, 64)].sort());
      expect(remaining.find(row => row.ipHash === null)?.workEmail).toBe("fixture@example.test");
    } finally {
      await db.delete(stripeEvents).where(inArray(stripeEvents.eventId, eventIds));
      await db.delete(auditEvents).where(inArray(auditEvents.id, audits.map(row => row.id)));
      await db.delete(betaApplications).where(inArray(betaApplications.id, applications.map(row => row.id)));
    }
  });
  it("rejects unscoped IDs and unsafe batch sizes before any mutation", async () => {
    await expect(purgeWorkspaceRetention("", now)).rejects.toThrow();
    await expect(purgeWorkspaceRetention(randomUUID(), now, 101)).rejects.toThrow();
  });
});
