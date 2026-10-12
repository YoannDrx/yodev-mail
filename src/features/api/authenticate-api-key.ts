import { and, eq, isNull } from "drizzle-orm";
import { requireDb } from "@/db";
import { apiKeys, workspaces } from "@/db/schema";
import { hmac } from "@/lib/crypto";
import { env } from "@/lib/env";

export async function authenticateApiKey(request: Request, scope: string) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token?.startsWith("ym_") || !env.API_KEY_PEPPER) return null;
  const db = requireDb();
  // A soft-deleted workspace keeps its rows for retention, but none of its
  // keys may authenticate any more.
  const [row] = await db
    .select({ key: apiKeys })
    .from(apiKeys)
    .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
    .where(and(
      eq(apiKeys.secretHash, hmac(token, env.API_KEY_PEPPER)),
      isNull(apiKeys.revokedAt),
      isNull(workspaces.deletedAt),
    ))
    .limit(1);
  const key = row?.key;
  if (!key || !key.scopes.includes(scope)) return null;
  if (key.mode === "test" && !token.startsWith("ym_test_")) return null;
  if (key.mode === "live" && !token.startsWith("ym_live_")) return null;
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(apiKeys.id, key.id), eq(apiKeys.workspaceId, key.workspaceId)));
  return key;
}
