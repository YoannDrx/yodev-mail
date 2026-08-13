import { and, eq, lt, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { messages, usageDays } from "@/db/schema";
import { utcDay } from "@/features/sending/eligibility";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

const SENDING_LEASE_MS = 15 * 60_000;

export async function recoverStaleSending(limit = 100, now = new Date()) {
  const db = requireDb();
  const staleBefore = new Date(now.getTime() - SENDING_LEASE_MS);
  const candidates = await db.select({ id: messages.id, workspaceId: messages.workspaceId, queuedAt: messages.queuedAt })
    .from(messages)
    .where(and(eq(messages.status, "sending"), lt(messages.sendingClaimedAt, staleBefore)))
    .limit(limit);
  let recovered = 0;
  for (const candidate of candidates) {
    await db.transaction(async (tx) => {
      const updated = await tx.update(messages).set({
        status: "unknown",
        ambiguousAt: now,
        lastError: "sending_lease_expired",
        updatedAt: now,
      }).where(and(
        eq(messages.id, candidate.id),
        eq(messages.workspaceId, candidate.workspaceId),
        eq(messages.status, "sending"),
        lt(messages.sendingClaimedAt, staleBefore),
      )).returning({ id: messages.id });
      if (!updated.length) return;
      await tx.update(usageDays).set({
        reservedEmails: sql`greatest(${usageDays.reservedEmails} - 1, 0)`,
        updatedAt: now,
      }).where(and(eq(usageDays.workspaceId, candidate.workspaceId), eq(usageDays.day, utcDay(candidate.queuedAt))));
      recovered += 1;
    });
  }
  if (recovered) emitOperationalMetric("ProviderOutcomeUnknown", recovered);
  return { recovered, scanned: candidates.length };
}

export async function handler() {
  await loadRuntimeSecrets();
  return recoverStaleSending();
}
