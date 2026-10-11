import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ isFeatureEnabled: () => false }));
vi.mock("@/lib/aws", () => ({ awsClients: vi.fn() }));
vi.mock("@/features/providers/registry", () => ({ deliveryProvider: () => ({ send }) }));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: vi.fn() }));

import { databasePool, requireDb } from "@/db/runtime";
import { domains, emailEvents, messageAttempts, messages, transactionalProfiles, usageDays, workspaces } from "@/db/schema";
import { utcDay } from "@/features/sending/eligibility";
import { expireQueuedPastDeadline } from "@/features/sending/expire-queued";
import { handler as recoveryHandler } from "@/workers/recover-stale-sending";
import { sendOne } from "@/workers/send-email";

const db = requireDb();
const pool = databasePool!;
let workspaceId: string;
let domainId: string;
let profileId: string;
const queuedAt = new Date(Date.now() - 26 * 3600_000);

beforeEach(async () => {
  workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "Expiry", slug: workspaceId, status: "approved" });
  const [domain] = await db.insert(domains).values({ workspaceId, name: `${workspaceId}.example.test`, status: "verified" }).returning();
  domainId = domain.id;
  const [profile] = await db.insert(transactionalProfiles).values({
    workspaceId, key: "receipt", name: "Receipt", triggerDescription: "Purchase", recipientRelationship: "Customer", contentExample: "Receipt", status: "approved",
  }).returning();
  profileId = profile.id;
  await db.insert(usageDays).values({ workspaceId, day: utcDay(queuedAt), reservedEmails: 4 });
  send.mockReset();
});
afterEach(async () => { await db.delete(workspaces).where(eq(workspaces.id, workspaceId)); });
afterAll(async () => { await pool.end(); });

async function seed(status: "queued" | "sending", sendDeadlineAt: Date | null) {
  const [message] = await db.insert(messages).values({
    workspaceId, domainId, transactionalProfileId: profileId, provider: "postmark", stream: "transactional", status,
    queuedAt, sendDeadlineAt, sendingClaimedAt: status === "sending" ? new Date() : null,
    fromEmail: "sender@example.test", toEmail: "recipient@example.test", subject: "Synthetic", html: "<p>x</p>", plainText: "x",
  }).returning();
  return message;
}

async function state(id: string) {
  const [message] = await db.select().from(messages).where(and(eq(messages.id, id), eq(messages.workspaceId, workspaceId)));
  return message;
}

it("fails queued messages past their deadline once, releasing the reservation and emitting email.failed", async () => {
  const stranded = await seed("queued", new Date(Date.now() - 2 * 3600_000));
  const legacy = await seed("queued", null);
  const future = await seed("queued", new Date(Date.now() + 3600_000));
  const inFlight = await seed("sending", new Date(Date.now() - 3600_000));

  const first = await expireQueuedPastDeadline();
  const second = await expireQueuedPastDeadline();

  expect(first.expired).toBe(2);
  expect(second.expired).toBe(0);
  for (const id of [stranded.id, legacy.id]) {
    const message = await state(id);
    expect(message).toMatchObject({ status: "failed", lastError: "send_deadline_exceeded" });
    expect(message.failedAt).toBeInstanceOf(Date);
    const events = await db.select().from(emailEvents).where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.messageId, id)));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "email.failed", payload: { errorCode: "send_deadline_exceeded" } });
    const attempts = await db.select().from(messageAttempts).where(and(eq(messageAttempts.workspaceId, workspaceId), eq(messageAttempts.messageId, id)));
    expect(attempts).toMatchObject([{ outcome: "definitive_failure", errorCode: "send_deadline_exceeded", status: "failed" }]);
  }
  expect((await state(future.id)).status).toBe("queued");
  expect((await state(inFlight.id)).status).toBe("sending");
  const [usage] = await db.select().from(usageDays).where(eq(usageDays.workspaceId, workspaceId));
  expect(usage.reservedEmails).toBe(2);
});

it("makes a DLQ redrive of an expired message a no-op", async () => {
  const stranded = await seed("queued", new Date(Date.now() - 60_000));
  await recoveryHandler();
  await sendOne(stranded.id, workspaceId);
  expect(send).not.toHaveBeenCalled();
  expect((await state(stranded.id)).status).toBe("failed");
});
