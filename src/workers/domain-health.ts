import { and, eq, inArray } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { domains } from "@/db/schema";
import { checkSesDomain } from "@/features/domains/check-domain";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const db = requireDb();
  const candidates = await db
    .select()
    .from(domains)
    .where(inArray(domains.status, ["pending", "verified", "failed"]))
    .limit(50);
  let checked = 0;
  for (const domain of candidates) {
    try {
      const result = await checkSesDomain(domain.name);
      await db
        .update(domains)
        .set({
          ...result,
          lastCheckError: null,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
          verifiedAt:
            result.status === "verified" ? domain.verifiedAt ?? new Date() : null,
        })
        .where(
          and(
            eq(domains.id, domain.id),
            eq(domains.workspaceId, domain.workspaceId),
          ),
        );
      checked += 1;
    } catch (error) {
      await db
        .update(domains)
        .set({
          lastCheckError:
            error instanceof Error ? error.message : "Domain check failed",
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(domains.id, domain.id),
            eq(domains.workspaceId, domain.workspaceId),
          ),
        );
    }
  }
  return { checked };
}
