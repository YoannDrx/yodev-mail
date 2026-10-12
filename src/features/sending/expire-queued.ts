import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { messages } from "@/db/schema";
import { releaseReservationInTransaction } from "@/features/billing/usage-ledger";
import { recordAttemptInTransaction } from "@/features/sending/attempts";
import { queuePublicEmailEventInTransaction } from "@/features/webhooks/public-email-event";

// Messages accepted before send deadlines were stored fall back to this one.
const LEGACY_SEND_WINDOW_MS = 24 * 3600_000;
export const SEND_DEADLINE_EXCEEDED = "send_deadline_exceeded";

function expiredQueued(now: Date) {
  return and(
    eq(messages.status, "queued"),
    or(
      lte(messages.sendDeadlineAt, now),
      and(isNull(messages.sendDeadlineAt), lt(messages.queuedAt, new Date(now.getTime() - LEGACY_SEND_WINDOW_MS))),
    ),
  );
}

/**
 * A job that reached the dead-letter queue (or was never dispatched) leaves
 * its message `queued` with a quota reservation. Past the send deadline it can
 * never be sent: fail it exactly like the send worker's own deadline check,
 * release the reservation and emit `email.failed`. A later redrive of the SQS
 * job is then a no-op, because the worker only claims `queued` messages.
 */
export async function expireQueuedPastDeadline(limit = 100, now = new Date()) {
  const db = requireDb();
  const candidates = await db.select({ id: messages.id, workspaceId: messages.workspaceId })
    .from(messages)
    .where(expiredQueued(now))
    .orderBy(messages.sendDeadlineAt)
    .limit(limit);
  let expired = 0;
  for (const candidate of candidates) {
    const done = await db.transaction(async (tx) => {
      const [updated] = await tx.update(messages).set({
        status: "failed",
        failedAt: now,
        lastError: SEND_DEADLINE_EXCEEDED,
        updatedAt: now,
      }).where(and(
        eq(messages.id, candidate.id),
        eq(messages.workspaceId, candidate.workspaceId),
        expiredQueued(now),
      )).returning({ provider: messages.provider, queuedAt: messages.queuedAt });
      if (!updated) return false;
      await releaseReservationInTransaction(tx, candidate.workspaceId, updated.queuedAt);
      if (updated.provider) {
        await recordAttemptInTransaction(tx, {
          workspaceId: candidate.workspaceId,
          messageId: candidate.id,
          provider: updated.provider,
          status: "failed",
          outcome: "definitive_failure",
          errorCode: SEND_DEADLINE_EXCEEDED,
        });
      }
      await queuePublicEmailEventInTransaction(tx, {
        workspaceId: candidate.workspaceId,
        messageId: candidate.id,
        provider: updated.provider,
        type: "email.failed",
        occurredAt: now,
        errorCode: SEND_DEADLINE_EXCEEDED,
      });
      return true;
    });
    if (done) expired += 1;
  }
  return { expired, scannedQueued: candidates.length };
}
