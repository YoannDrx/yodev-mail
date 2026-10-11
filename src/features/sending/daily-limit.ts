import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/runtime";
import { auditEvents, workspaces } from "@/db/schema";
import { warmupLimitForStage } from "@/features/sending/warmup";

/** Highest limit an operator may grant; above it, raise this bound in review. */
export const MAX_OPERATOR_DAILY_LIMIT = 50_000;

const inputSchema = z.object({
  workspaceId: z.uuid(),
  // null hands the workspace back to the automatic warmup limit of its stage.
  dailyLimit: z.number().int().min(1).max(MAX_OPERATOR_DAILY_LIMIT).nullable(),
  actorUserId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});

export class DailyLimitWorkspaceNotFoundError extends Error {
  constructor() {
    super("workspace_not_found");
    this.name = "DailyLimitWorkspaceNotFoundError";
  }
}

/**
 * Pins (or releases) a workspace's daily sending limit. Scoped to one
 * workspace, bounded, and audited in the same transaction. A pinned limit is
 * left alone by the warmup worker and by billing events.
 */
export async function setWorkspaceDailyLimit(input: z.input<typeof inputSchema>) {
  const { actorUserId, dailyLimit, reason, workspaceId } = inputSchema.parse(input);
  return requireDb().transaction(async (tx) => {
    const [workspace] = await tx.select({
      dailyLimit: workspaces.dailyLimit,
      overriddenAt: workspaces.dailyLimitOverriddenAt,
      warmupStage: workspaces.warmupStage,
    }).from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
      .for("update");
    if (!workspace) throw new DailyLimitWorkspaceNotFoundError();
    const now = new Date();
    const nextLimit = dailyLimit ?? warmupLimitForStage(workspace.warmupStage);
    await tx.update(workspaces).set({
      dailyLimit: nextLimit,
      dailyLimitOverriddenAt: dailyLimit === null ? null : now,
      updatedAt: now,
    }).where(eq(workspaces.id, workspaceId));
    await tx.insert(auditEvents).values({
      workspaceId,
      actorUserId,
      action: dailyLimit === null ? "workspace.daily_limit_released" : "workspace.daily_limit_set",
      entityType: "workspace",
      entityId: workspaceId,
      metadata: {
        previousDailyLimit: workspace.dailyLimit,
        previouslyOverridden: workspace.overriddenAt !== null,
        dailyLimit: nextLimit,
        warmupStage: workspace.warmupStage,
        reason,
      },
    });
    return { dailyLimit: nextLimit, overridden: dailyLimit !== null };
  });
}

/** Read helper for the admin view: current limit, stage and override state. */
export async function getWorkspaceDailyLimit(workspaceId: string) {
  z.uuid().parse(workspaceId);
  const [row] = await requireDb().select({
    dailyLimit: workspaces.dailyLimit,
    overriddenAt: workspaces.dailyLimitOverriddenAt,
    warmupStage: workspaces.warmupStage,
  }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return row ? { ...row, automaticLimit: warmupLimitForStage(row.warmupStage) } : null;
}
