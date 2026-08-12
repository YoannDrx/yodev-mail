import { and, isNotNull, lt, lte } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { emailEvents, messages } from "@/db/schema";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const db = requireDb();
  const now = new Date();
  const bodies = await db.update(messages).set({
    subject: "[contenu expiré]",
    html: "",
    plainText: "",
    contentExpiresAt: null,
    updatedAt: now,
  }).where(and(isNotNull(messages.contentExpiresAt), lte(messages.contentExpiresAt, now))).returning({ id: messages.id });
  const deletedEvents = await db.delete(emailEvents)
    .where(lt(emailEvents.occurredAt, new Date(now.getTime() - 90 * 864e5)))
    .returning({ id: emailEvents.id });
  return { expiredBodies: bodies.length, deletedEvents: deletedEvents.length };
}
