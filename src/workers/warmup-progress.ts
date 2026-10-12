import { and, between, desc, eq, isNull, lte } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { auditEvents, usageDays, workspaces } from "@/db/schema";
import { utcDay } from "@/features/sending/eligibility";
import { maxWarmupStage, nextWarmupStep, warmupDecision } from "@/features/sending/warmup";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const db = requireDb();
  // Operator-pinned limits (dailyLimitOverriddenAt) are never changed here.
  const candidates = await db.select().from(workspaces).where(and(
    eq(workspaces.status, "approved"),
    between(workspaces.warmupStage, 1, maxWarmupStage - 1),
    isNull(workspaces.dailyLimitOverriddenAt),
  ));
  let advancedCount = 0;
  for (const workspace of candidates) {
    const currentStage = workspace.warmupStage;
    const next = nextWarmupStep(currentStage);
    if (!next) continue;
    const reference = currentStage === 1 ? workspace.approvedAt : workspace.warmupAdvancedAt;
    const recent = await db.select().from(usageDays)
      .where(and(eq(usageDays.workspaceId, workspace.id), lte(usageDays.day, utcDay(new Date()))))
      .orderBy(desc(usageDays.day)).limit(next.sampleDays);
    const totals = recent.reduce((result, day) => ({
      accepted: result.accepted + day.acceptedEmails,
      complaints: result.complaints + day.complaints,
      hardBounces: result.hardBounces + day.hardBounces,
    }), { accepted: 0, complaints: 0, hardBounces: 0 });
    const decision = warmupDecision({ stage: currentStage, reference, sample: totals });
    if (!decision.advance) continue;
    const [advanced] = await db.update(workspaces).set({
      dailyLimit: decision.dailyLimit,
      warmupAdvancedAt: new Date(),
      warmupStage: decision.toStage,
      updatedAt: new Date(),
    }).where(and(
      eq(workspaces.id, workspace.id),
      eq(workspaces.status, "approved"),
      eq(workspaces.warmupStage, currentStage),
      isNull(workspaces.dailyLimitOverriddenAt),
    )).returning({ id: workspaces.id });
    if (advanced) {
      advancedCount += 1;
      await db.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: "system:warmup", action: "workspace.warmup_advanced", entityType: "workspace", entityId: workspace.id, metadata: { fromStage: currentStage, toStage: decision.toStage, dailyLimit: decision.dailyLimit, ...totals } });
    }
  }
  return { advanced: advancedCount, checked: candidates.length };
}
