import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isFeatureEnabled: () => false }));

import { databasePool, requireDb } from "@/db/runtime";
import { auditEvents, domains, emailEvents, messages, suppressions, usageDays, workspaces } from "@/db/schema";
import { ingestProviderEvent } from "./ingest-event";
import type { NormalizedProviderEvent } from "./normalize-event";

const db = requireDb();
const pool = databasePool!;
let workspaceId: string;
let domainId: string;
beforeEach(async () => {
  workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "Synthetic events", slug: workspaceId, status: "approved" });
  const [domain] = await db.insert(domains).values({ workspaceId, name: `${workspaceId}.example.test` }).returning();
  domainId = domain.id;
});
afterEach(async () => {
  await pool.query("drop trigger if exists certification_fail_pause_audit on audit_events");
  await pool.query("drop trigger if exists certification_fail_pause on workspaces");
  await pool.query("drop function if exists certification_fail_pause()");
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
});
afterAll(async () => { await pool.end(); });

async function seedMessage(providerMessageId: string | null = randomUUID()) {
  const [message] = await db.insert(messages).values({
    workspaceId, domainId, provider: "ses", providerMessageId, stream: "transactional", status: "sent",
    fromEmail: "sender@example.test", toEmail: `${randomUUID()}@example.test`, subject: "Synthetic", html: "<p>Synthetic</p>", plainText: "Synthetic",
  }).returning();
  return message;
}
function event(message: Awaited<ReturnType<typeof seedMessage>>, overrides: Partial<NormalizedProviderEvent> = {}): NormalizedProviderEvent {
  return { provider: "ses", externalEventId: randomUUID(), messageId: message.id, workspaceId, providerMessageId: message.providerMessageId ?? randomUUID(), type: "complained", occurredAt: new Date(), ...overrides };
}
async function snapshot() {
  return {
    workspace: (await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)))[0],
    events: await db.select().from(emailEvents).where(eq(emailEvents.workspaceId, workspaceId)),
    suppressions: await db.select().from(suppressions).where(eq(suppressions.workspaceId, workspaceId)),
    usage: await db.select().from(usageDays).where(eq(usageDays.workspaceId, workspaceId)),
    audits: await db.select().from(auditEvents).where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.action, "workspace.auto_paused"))),
  };
}

it("rolls back the complaint and its effects when automatic suspension cannot commit", async () => {
  const message = await seedMessage();
  const complaint = event(message);
  await pool.query(`create function certification_fail_pause() returns trigger language plpgsql as $$
    begin if new.pause_reason = 'reputation' then raise exception 'synthetic_pause_failure'; end if; return new; end $$`);
  await pool.query("create trigger certification_fail_pause before update on workspaces for each row execute function certification_fail_pause()");
  await expect(ingestProviderEvent(complaint)).rejects.toThrow();
  const failed = await snapshot();
  expect(failed.workspace.status).toBe("approved");
  expect(failed.events).toHaveLength(0);
  expect(failed.suppressions).toHaveLength(0);
  expect(failed.usage).toHaveLength(0);
  await pool.query("drop trigger certification_fail_pause on workspaces");
  await expect(ingestProviderEvent(complaint)).resolves.toEqual({ skipped: false, duplicate: false });
  const recovered = await snapshot();
  expect(recovered.workspace.status).toBe("paused");
  expect(recovered.events).toHaveLength(1);
  expect(recovered.audits).toHaveLength(1);
  expect(recovered.usage[0].complaints).toBe(1);
});

it("does not trust a message tag that conflicts with its stored provider message id", async () => {
  const message = await seedMessage();
  await expect(ingestProviderEvent(event(message, { providerMessageId: randomUUID() }))).resolves.toEqual({ skipped: true });
  const state = await snapshot();
  expect(state.workspace.status).toBe("approved");
  expect(state.events).toHaveLength(0);
  expect(state.suppressions).toHaveLength(0);
});

it("does not fall back to another message when an explicit message tag is contradictory", async () => {
  const message = await seedMessage();
  await expect(ingestProviderEvent(event(message, { messageId: randomUUID() }))).resolves.toEqual({ skipped: true });
  expect((await snapshot()).events).toHaveLength(0);
});

it("rolls back suspension and event when the corresponding audit cannot commit", async () => {
  const message = await seedMessage();
  await pool.query(`create function certification_fail_pause() returns trigger language plpgsql as $$
    begin raise exception 'synthetic_audit_failure'; end $$`);
  await pool.query("create trigger certification_fail_pause_audit before insert on audit_events for each row execute function certification_fail_pause()");
  await expect(ingestProviderEvent(event(message))).rejects.toThrow();
  const state = await snapshot();
  expect(state.workspace.status).toBe("approved");
  expect(state.events).toHaveLength(0);
  expect(state.audits).toHaveLength(0);
  expect(state.suppressions).toHaveLength(0);
});

it("commits a concurrent duplicate once, including reputation and its audit", async () => {
  const message = await seedMessage();
  const complaint = event(message);
  const results = await Promise.all([ingestProviderEvent(complaint), ingestProviderEvent(complaint)]);
  expect(results.filter(result => result.duplicate)).toHaveLength(1);
  const state = await snapshot();
  expect(state.workspace.status).toBe("paused");
  expect(state.events).toHaveLength(1);
  expect(state.audits).toHaveLength(1);
  expect(state.suppressions).toHaveLength(1);
  expect(state.usage[0].complaints).toBe(1);
});

it("serializes the reputation threshold across concurrent messages on different days", async () => {
  const events = await Promise.all([0, 1, 2].map(async days => event(await seedMessage(), {
    type: "hard_bounced", occurredAt: new Date(Date.now() - days * 864e5),
  })));
  await Promise.all(events.map(ingestProviderEvent));
  const state = await snapshot();
  expect(state.workspace.status).toBe("paused");
  expect(state.audits).toHaveLength(1);
  expect(state.usage.reduce((sum, row) => sum + row.hardBounces, 0)).toBe(3);
  expect(state.audits[0].metadata.hardBounces).toBe(3);
});

it("preserves a non-reputation suspension while recording safety events", async () => {
  const message = await seedMessage();
  await db.update(workspaces).set({ status: "paused", pauseReason: "manual-review" }).where(eq(workspaces.id, workspaceId));
  await ingestProviderEvent(event(message));
  const state = await snapshot();
  expect(state.workspace.pauseReason).toBe("manual-review");
  expect(state.audits).toHaveLength(0);
  expect(state.suppressions).toHaveLength(1);
});

it("rejects wrong workspace/provider/test-mode correlation without side effects", async () => {
  const message = await seedMessage();
  expect(await ingestProviderEvent(event(message, { workspaceId: randomUUID() }))).toEqual({ skipped: true });
  expect(await ingestProviderEvent(event(message, { provider: "postmark" }))).toEqual({ skipped: true });
  expect(await ingestProviderEvent(event(message, { workspaceId: undefined }))).toEqual({ skipped: true });
  await db.update(messages).set({ sendMode: "test", status: "simulated" }).where(and(eq(messages.id, message.id), eq(messages.workspaceId, workspaceId)));
  expect(await ingestProviderEvent(event(message))).toEqual({ skipped: true });
  expect((await snapshot()).events).toHaveLength(0);
});

it("accepts a correctly tagged early event before the provider id is persisted", async () => {
  const message = await seedMessage(null);
  await db.update(messages).set({ status: "sending" }).where(and(eq(messages.id, message.id), eq(messages.workspaceId, workspaceId)));
  const delivery = event(message, { type: "delivered" });
  expect(await ingestProviderEvent(delivery)).toEqual({ skipped: false, duplicate: false });
  const [stored] = await db.select().from(messages).where(and(eq(messages.id, message.id), eq(messages.workspaceId, workspaceId)));
  expect(stored.providerMessageId).toBe(delivery.providerMessageId);
  expect(stored.status).toBe("delivered");
  expect((await snapshot()).suppressions).toHaveLength(0);
});

it("rechecks provider identity after waiting for the message lock", async () => {
  const message = await seedMessage();
  const blocker = await pool.connect();
  let processing: Promise<Awaited<ReturnType<typeof ingestProviderEvent>>> | undefined;
  try {
    await blocker.query("begin");
    await blocker.query("select id from messages where workspace_id=$1 and id=$2 for update", [workspaceId, message.id]);
    const { rows: [{ pid }] } = await blocker.query<{ pid: number }>("select pg_backend_pid() as pid");
    processing = ingestProviderEvent(event(message));
    await vi.waitFor(async () => {
      const { rows: [{ waiting }] } = await pool.query<{ waiting: boolean }>("select exists(select 1 from pg_stat_activity where $1=any(pg_blocking_pids(pid))) as waiting", [pid]);
      expect(waiting).toBe(true);
    }, { timeout: 5000, interval: 20 });
    await blocker.query("update messages set provider_message_id=$1 where workspace_id=$2 and id=$3", [randomUUID(), workspaceId, message.id]);
    await blocker.query("commit");
    expect(await processing).toEqual({ skipped: true });
    expect((await snapshot()).events).toHaveLength(0);
  } finally {
    await blocker.query("rollback");
    blocker.release();
    await processing;
  }
});
