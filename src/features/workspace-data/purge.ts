import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/runtime";
import { workspaces } from "@/db/schema";

// Worker-safe (no server-only import): the retention Lambda finishes purges.

/** Tables purged batch by batch before the final cascade, largest first. */
const purgeOrder = [
  "webhook_deliveries",
  "email_events",
  "message_attempts",
  "usage_ledger",
  "stripe_usage_report_jobs",
  "stripe_usage_reports",
  "attachments",
  "outbox_jobs",
  "idempotency_keys",
  "suppressions",
  "messages",
] as const;

/**
 * Deletes the data of a workspace whose owner asked for deletion. Only acts
 * on a row marked by requestWorkspaceDeletion, so it can never remove a
 * live workspace. Bounded per statement and by the time budget; call again
 * until `done`.
 */
export async function purgeDeletedWorkspace(
  workspaceId: string,
  options: { budgetMs?: number; batchSize?: number } = {},
): Promise<{ done: boolean }> {
  z.uuid().parse(workspaceId);
  const batchSize = z.number().int().min(1).max(10_000).parse(options.batchSize ?? 5_000);
  const deadline = Date.now() + (options.budgetMs ?? 15_000);
  const db = requireDb();
  const marked = async () => {
    const [row] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNotNull(workspaces.purgeRequestedAt), isNotNull(workspaces.deletedAt)))
      .limit(1);
    return Boolean(row);
  };
  if (!(await marked())) return { done: true };
  for (const table of purgeOrder) {
    for (;;) {
      if (Date.now() >= deadline) return { done: false };
      const deleted = await db.transaction(async (tx) => {
        await tx.execute(sql`set local statement_timeout = '10s'`);
        const key = sql.raw(table === "usage_ledger" ? "message_id" : "id");
        // webhook_deliveries has no workspace index: reach it through its endpoints.
        const scope = table === "webhook_deliveries"
          ? sql`endpoint_id in (select id from webhook_endpoints where workspace_id = ${workspaceId}) and workspace_id = ${workspaceId}`
          : sql`workspace_id = ${workspaceId}`;
        const result = await tx.execute(sql`
          delete from ${sql.identifier(table)} where ${key} in (
            select ${key} from ${sql.identifier(table)}
            where ${scope}
              and exists (select 1 from workspaces where id = ${workspaceId} and purge_requested_at is not null and deleted_at is not null)
            limit ${batchSize}
          )`);
        return result.rowCount ?? 0;
      });
      if (deleted < batchSize) break;
    }
  }
  if (Date.now() >= deadline) return { done: false };
  // The remaining rows are small per-workspace tables; the cascade removes them.
  await db
    .delete(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNotNull(workspaces.purgeRequestedAt), isNotNull(workspaces.deletedAt)));
  return { done: true };
}

/** Workspaces whose deletion was requested but whose purge is unfinished. */
export async function pendingWorkspacePurges(limit = 5) {
  const rows = await requireDb()
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(isNotNull(workspaces.purgeRequestedAt))
    .orderBy(workspaces.purgeRequestedAt)
    .limit(limit);
  return rows.map((row) => row.id);
}
