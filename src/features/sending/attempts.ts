import { and, eq, sql } from "drizzle-orm";
import { messageAttempts } from "@/db/schema";
import type { DatabaseTransaction } from "@/features/webhooks/public-email-event";

export type AttemptInput = {
  workspaceId: string;
  messageId: string;
  provider: "ses" | "postmark";
  status: string;
  outcome: "accepted" | "definitive_failure" | "transient_failure" | "ambiguous";
  errorCode?: string;
};

export async function recordAttemptInTransaction(
  tx: DatabaseTransaction,
  input: AttemptInput,
) {
  const [latest] = await tx.select({ value: sql<number>`coalesce(max(${messageAttempts.attempt}), 0)::int` })
    .from(messageAttempts).where(and(
      eq(messageAttempts.messageId, input.messageId),
      eq(messageAttempts.workspaceId, input.workspaceId),
    ));
  await tx.insert(messageAttempts).values({ ...input, attempt: (latest?.value ?? 0) + 1 });
}
