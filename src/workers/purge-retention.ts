import { and, eq, isNotNull, lt, lte, ne } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  emailEvents,
  idempotencyKeys,
  messages,
  outboxJobs,
  suppressions,
} from "@/db/schema";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const db = requireDb();
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 864e5);
  const bodies = await db.update(messages).set({
    subject: "[contenu expiré]",
    html: "",
    plainText: "",
    contentExpiresAt: null,
    updatedAt: now,
  }).where(and(isNotNull(messages.contentExpiresAt), lte(messages.contentExpiresAt, now))).returning({ id: messages.id });
  const deletedEvents = await db.delete(emailEvents)
    .where(lt(emailEvents.occurredAt, ninetyDaysAgo))
    .returning({ id: emailEvents.id });
  const anonymizedMessages = await db.update(messages).set({
    fromEmail: "redacted@yodev.invalid",
    fromName: null,
    toEmail: "redacted@yodev.invalid",
    toName: null,
    replyTo: null,
    subject: "[contenu expiré]",
    html: "",
    plainText: "",
    contentExpiresAt: null,
    tags: {},
    updatedAt: now,
  }).where(and(
    lt(messages.queuedAt, ninetyDaysAgo),
    ne(messages.toEmail, "redacted@yodev.invalid"),
  )).returning({ id: messages.id });
  const anonymizedSuppressions = await db.update(suppressions).set({
    normalizedEmail: null,
  }).where(and(
    lt(suppressions.createdAt, ninetyDaysAgo),
    isNotNull(suppressions.normalizedEmail),
  )).returning({ id: suppressions.id });
  const deletedIdempotencyKeys = await db.delete(idempotencyKeys)
    .where(lt(idempotencyKeys.createdAt, ninetyDaysAgo))
    .returning({ id: idempotencyKeys.id });
  const deletedOutboxJobs = await db.delete(outboxJobs)
    .where(and(
      eq(outboxJobs.status, "delivered"),
      lt(outboxJobs.updatedAt, ninetyDaysAgo),
    ))
    .returning({ id: outboxJobs.id });
  return {
    anonymizedMessages: anonymizedMessages.length,
    anonymizedSuppressions: anonymizedSuppressions.length,
    deletedEvents: deletedEvents.length,
    deletedIdempotencyKeys: deletedIdempotencyKeys.length,
    deletedOutboxJobs: deletedOutboxJobs.length,
    expiredBodies: bodies.length,
  };
}
