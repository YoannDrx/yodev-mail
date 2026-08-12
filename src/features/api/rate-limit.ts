import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { apiRateLimits } from "@/db/schema";

export async function consumeWorkspaceRateLimit(workspaceId: string, mode: "test" | "live") {
  const now = new Date();
  const minute = new Date(now);
  minute.setUTCSeconds(0, 0);
  const limit = mode === "live" ? 60 : 10;
  const [row] = await requireDb().insert(apiRateLimits).values({ workspaceId, mode, minute }).onConflictDoUpdate({
    target: [apiRateLimits.workspaceId, apiRateLimits.mode, apiRateLimits.minute],
    set: { requestCount: sql`${apiRateLimits.requestCount} + 1` },
    setWhere: sql`${apiRateLimits.requestCount} < ${limit}`,
  }).returning({ requestCount: apiRateLimits.requestCount });
  return {
    allowed: Boolean(row),
    limit,
    remaining: Math.max(0, limit - (row?.requestCount ?? limit)),
    resetAt: new Date(minute.getTime() + 60_000),
  };
}
