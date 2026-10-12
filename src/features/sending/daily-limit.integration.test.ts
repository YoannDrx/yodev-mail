import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: vi.fn() }));

import { databasePool, requireDb } from "@/db/runtime";
import { auditEvents, usageDays, workspaces } from "@/db/schema";
import { setWorkspaceDailyLimit } from "@/features/sending/daily-limit";
import { utcDay } from "@/features/sending/eligibility";
import { handler as warmupProgress } from "@/workers/warmup-progress";

const db = requireDb();
const pool = databasePool!;
const created: string[] = [];
afterEach(async () => {
  if (created.length) await db.delete(workspaces).where(inArray(workspaces.id, created.splice(0)));
});
afterAll(async () => { await pool.end(); });

async function seedWorkspace(stage: number, dailyLimit: number, acceptedPerDay = 0) {
  const id = randomUUID();
  created.push(id);
  await db.insert(workspaces).values({
    id, name: "Limits", slug: id, status: "approved", warmupStage: stage, dailyLimit,
    approvedAt: new Date(Date.now() - 60 * 864e5), warmupAdvancedAt: new Date(Date.now() - 30 * 864e5),
  });
  if (acceptedPerDay) {
    await db.insert(usageDays).values(Array.from({ length: 14 }, (_, index) => ({
      workspaceId: id, day: utcDay(new Date(Date.now() - index * 864e5)), acceptedEmails: acceptedPerDay,
    })));
  }
  return id;
}

async function workspace(id: string) {
  const [row] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  return row;
}

it("pins a bounded limit on one workspace only and audits it", async () => {
  const target = await seedWorkspace(3, 500);
  const other = await seedWorkspace(3, 500);

  await expect(setWorkspaceDailyLimit({ workspaceId: target, dailyLimit: 0, actorUserId: "admin", reason: "too low" })).rejects.toThrow();
  await expect(setWorkspaceDailyLimit({ workspaceId: target, dailyLimit: 50_001, actorUserId: "admin", reason: "too high" })).rejects.toThrow();
  await expect(setWorkspaceDailyLimit({ workspaceId: target, dailyLimit: 3_000, actorUserId: "admin", reason: "" })).rejects.toThrow();
  await expect(setWorkspaceDailyLimit({ workspaceId: randomUUID(), dailyLimit: 3_000, actorUserId: "admin", reason: "missing" })).rejects.toThrow("workspace_not_found");

  await expect(setWorkspaceDailyLimit({ workspaceId: target, dailyLimit: 3_000, actorUserId: "admin-1", reason: "Contract volume" }))
    .resolves.toEqual({ dailyLimit: 3_000, overridden: true });

  expect(await workspace(target)).toMatchObject({ dailyLimit: 3_000, warmupStage: 3 });
  expect((await workspace(target)).dailyLimitOverriddenAt).toBeInstanceOf(Date);
  expect(await workspace(other)).toMatchObject({ dailyLimit: 500, dailyLimitOverriddenAt: null });
  const audits = await db.select().from(auditEvents).where(and(eq(auditEvents.workspaceId, target), eq(auditEvents.action, "workspace.daily_limit_set")));
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorUserId: "admin-1", metadata: { previousDailyLimit: 500, dailyLimit: 3_000, reason: "Contract volume", warmupStage: 3 } });
});

it("keeps a pinned limit through warmup and returns to the stage limit when released", async () => {
  const pinned = await seedWorkspace(3, 500, 400);
  await setWorkspaceDailyLimit({ workspaceId: pinned, dailyLimit: 200, actorUserId: "admin", reason: "Throttle during review" });

  await warmupProgress();
  expect(await workspace(pinned)).toMatchObject({ dailyLimit: 200, warmupStage: 3 });

  await setWorkspaceDailyLimit({ workspaceId: pinned, dailyLimit: null, actorUserId: "admin", reason: "Review closed" });
  expect(await workspace(pinned)).toMatchObject({ dailyLimit: 500, dailyLimitOverriddenAt: null });
  const released = await db.select().from(auditEvents).where(and(eq(auditEvents.workspaceId, pinned), eq(auditEvents.action, "workspace.daily_limit_released")));
  expect(released).toHaveLength(1);
});

it("advances a healthy, active stage-3 workspace above 500 per day", async () => {
  const active = await seedWorkspace(3, 500, 400);
  const idle = await seedWorkspace(3, 500, 10);
  const top = await seedWorkspace(7, 10_000, 5_000);

  await warmupProgress();

  expect(await workspace(active)).toMatchObject({ dailyLimit: 1_000, warmupStage: 4 });
  expect(await workspace(idle)).toMatchObject({ dailyLimit: 500, warmupStage: 3 });
  expect(await workspace(top)).toMatchObject({ dailyLimit: 10_000, warmupStage: 7 });
  const advanced = await db.select().from(auditEvents).where(and(eq(auditEvents.workspaceId, active), eq(auditEvents.action, "workspace.warmup_advanced")));
  expect(advanced[0].metadata).toMatchObject({ fromStage: 3, toStage: 4, dailyLimit: 1_000 });
});
