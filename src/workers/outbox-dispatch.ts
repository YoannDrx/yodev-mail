import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { and, eq, lt, lte, or } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { outboxJobs } from "@/db/schema";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

const queueForKind = (kind: string) => {
  if (kind === "email") return process.env.EMAIL_QUEUE_URL;
  if (kind === "campaign") return process.env.CAMPAIGN_QUEUE_URL;
  if (kind === "webhook") return process.env.WEBHOOK_QUEUE_URL;
  return undefined;
};

const bodyForJob = (kind: string, aggregateId: string) => {
  if (kind === "email") return { messageId: aggregateId };
  if (kind === "campaign") return { campaignId: aggregateId };
  if (kind === "webhook") return { deliveryId: aggregateId };
  throw new Error(`Unsupported outbox job kind: ${kind}`);
};

export async function dispatchPendingOutbox(limit = 50) {
  const db = requireDb();
  const now = new Date();
  const staleClaim = new Date(now.getTime() - 5 * 60_000);
  const candidates = await db
    .select({ id: outboxJobs.id, workspaceId: outboxJobs.workspaceId })
    .from(outboxJobs)
    .where(
      and(
        lte(outboxJobs.availableAt, now),
        or(
          eq(outboxJobs.status, "pending"),
          and(
            eq(outboxJobs.status, "processing"),
            lt(outboxJobs.claimedAt, staleClaim),
          ),
        ),
      ),
    )
    .limit(limit);

  const sqs = new SQSClient({});
  let delivered = 0;

  for (const candidate of candidates) {
    const [job] = await db
      .update(outboxJobs)
      .set({ claimedAt: now, status: "processing", updatedAt: now })
      .where(
        and(
          eq(outboxJobs.id, candidate.id),
          eq(outboxJobs.workspaceId, candidate.workspaceId),
          or(
            eq(outboxJobs.status, "pending"),
            and(
              eq(outboxJobs.status, "processing"),
              lt(outboxJobs.claimedAt, staleClaim),
            ),
          ),
        ),
      )
      .returning();
    if (!job) continue;

    try {
      const queueUrl = queueForKind(job.kind);
      if (!queueUrl) throw new Error(`Queue is not configured for ${job.kind}`);
      await sqs.send(
        new SendMessageCommand({
          MessageBody: JSON.stringify(bodyForJob(job.kind, job.aggregateId)),
          QueueUrl: queueUrl,
        }),
      );
      await db
        .update(outboxJobs)
        .set({
          attempts: job.attempts + 1,
          deliveredAt: new Date(),
          lastError: null,
          status: "delivered",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outboxJobs.id, job.id),
            eq(outboxJobs.workspaceId, job.workspaceId),
          ),
        );
      delivered += 1;
    } catch (error) {
      const attempts = job.attempts + 1;
      const backoffSeconds = Math.min(900, 2 ** Math.min(attempts, 9));
      await db
        .update(outboxJobs)
        .set({
          attempts,
          availableAt: new Date(Date.now() + backoffSeconds * 1000),
          lastError: error instanceof Error ? error.message : "Outbox dispatch failed",
          status: "pending",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(outboxJobs.id, job.id),
            eq(outboxJobs.workspaceId, job.workspaceId),
          ),
        );
    }
  }

  return { delivered, scanned: candidates.length };
}

export async function handler() {
  await loadRuntimeSecrets();
  return dispatchPendingOutbox();
}
