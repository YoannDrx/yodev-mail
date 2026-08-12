import { and, desc, eq, lte, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { auditEvents, usageDays, workspaces } from "@/db/schema";
import { utcDay } from "@/features/sending/eligibility";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

const transitions = { 1: { limit: 200, waitDays: 3, sampleDays: 3 }, 2: { limit: 500, waitDays: 4, sampleDays: 7 } } as const;

export async function handler() {
  await loadRuntimeSecrets();
  const db = requireDb();
  const candidates = await db.select().from(workspaces).where(and(
    eq(workspaces.status, "approved"),
    sql`${workspaces.warmupStage} between 1 and 2`,
  ));
  for (const workspace of candidates) {
    const currentStage = workspace.warmupStage as 1 | 2;
    const target = transitions[currentStage];
    const reference = currentStage === 1 ? workspace.approvedAt : workspace.warmupAdvancedAt;
    if (!reference || reference > new Date(Date.now() - target.waitDays * 864e5)) continue;
    const recent = await db.select().from(usageDays)
      .where(and(eq(usageDays.workspaceId, workspace.id), lte(usageDays.day, utcDay(new Date()))))
      .orderBy(desc(usageDays.day)).limit(target.sampleDays);
    const totals = recent.reduce((result, day) => ({
      accepted: result.accepted + day.acceptedEmails,
      complaints: result.complaints + day.complaints,
      hardBounces: result.hardBounces + day.hardBounces,
    }), { accepted: 0, complaints: 0, hardBounces: 0 });
    const unsafe = totals.complaints > 0 || totals.hardBounces >= 3 || (totals.accepted >= 50 && totals.hardBounces / totals.accepted >= 0.02);
    if (unsafe) continue;
    const [advanced] = await db.update(workspaces).set({ dailyLimit: target.limit, warmupAdvancedAt: new Date(), warmupStage: currentStage + 1, updatedAt: new Date() }).where(and(eq(workspaces.id, workspace.id), eq(workspaces.status, "approved"), eq(workspaces.warmupStage, currentStage))).returning({ id: workspaces.id });
    if (advanced) await db.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: "system:warmup", action: "workspace.warmup_advanced", entityType: "workspace", entityId: workspace.id, metadata: { fromStage: currentStage, toStage: currentStage + 1, dailyLimit: target.limit, ...totals } });
  }
}
