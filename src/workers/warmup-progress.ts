import { and, desc, eq, gt, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { auditEvents, usageDays, workspaces } from "@/db/schema";
import { isPaidPlan, planCatalog } from "@/lib/plans";

const stageLimits = [200, 500, 1_000, 2_500, 5_000, 10_000] as const;

export async function handler() {
  const db = requireDb();
  const eligibleBefore = new Date(Date.now() - 23 * 3600_000);
  const candidates = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.status, "approved"),
        gt(workspaces.warmupStage, 0),
        sql`${workspaces.warmupStage} < 5`,
        sql`coalesce(${workspaces.warmupAdvancedAt}, 'epoch'::timestamptz) < ${eligibleBefore}`,
      ),
    );

  for (const workspace of candidates) {
    const recent = await db
      .select()
      .from(usageDays)
      .where(eq(usageDays.workspaceId, workspace.id))
      .orderBy(desc(usageDays.day))
      .limit(3);
    const totals = recent.reduce(
      (result, day) => ({
        accepted: result.accepted + day.acceptedEmails,
        complaints: result.complaints + day.complaints,
        hardBounces: result.hardBounces + day.hardBounces,
      }),
      { accepted: 0, complaints: 0, hardBounces: 0 },
    );
    if (totals.accepted < Math.min(100, Math.ceil(workspace.dailyLimit * 0.2))) continue;
    if (totals.hardBounces / totals.accepted >= 0.02 || totals.complaints / totals.accepted >= 0.001) continue;

    const nextStage = Math.min(5, workspace.warmupStage + 1);
    const planLimit = isPaidPlan(workspace.plan) ? planCatalog[workspace.plan].dailyLimit : stageLimits[nextStage];
    const nextLimit = Math.min(stageLimits[nextStage], planLimit);
    const [advanced] = await db
      .update(workspaces)
      .set({ dailyLimit: nextLimit, warmupAdvancedAt: new Date(), warmupStage: nextStage, updatedAt: new Date() })
      .where(and(eq(workspaces.id, workspace.id), eq(workspaces.status, "approved")))
      .returning({ id: workspaces.id });
    if (advanced) {
      await db.insert(auditEvents).values({
        workspaceId: workspace.id,
        actorUserId: "system:warmup",
        action: "workspace.warmup_advanced",
        entityType: "workspace",
        entityId: workspace.id,
        metadata: { fromStage: workspace.warmupStage, toStage: nextStage, dailyLimit: nextLimit, ...totals },
      });
    }
  }
}
