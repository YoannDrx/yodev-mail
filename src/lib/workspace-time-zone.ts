import "server-only";

import { eq } from "drizzle-orm";
import { requireDb } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { safeTimeZone } from "@/lib/date-time";

export async function getWorkspaceTimeZone(workspaceId: string) {
  const [settings] = await requireDb()
    .select({ timezone: workspaceSettings.timezone })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, workspaceId))
    .limit(1);
  return safeTimeZone(settings?.timezone);
}
