import { and, eq, inArray } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { domainProviderBindings, domains } from "@/db/schema";
import { checkPostmarkDomain } from "@/features/domains/check-postmark-domain";
import { checkSesDomain } from "@/features/domains/check-domain";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const db = requireDb();
  const candidates = await db.select({ binding: domainProviderBindings, domain: domains }).from(domainProviderBindings).innerJoin(domains, and(
    eq(domains.id, domainProviderBindings.domainId),
    eq(domains.workspaceId, domainProviderBindings.workspaceId),
  )).where(inArray(domainProviderBindings.status, ["pending", "dns_pending", "verified", "failed"])).limit(50);
  let checked = 0;
  for (const { binding } of candidates) {
    try {
      await checkBinding(binding.id);
      checked += 1;
    } catch { /* checkBinding persists a bounded operational error */ }
  }
  return { checked };
}

export async function checkBinding(bindingId: string) {
  await loadRuntimeSecrets();
  const db = requireDb();
  const [row] = await db.select({ binding: domainProviderBindings, domain: domains })
    .from(domainProviderBindings)
    .innerJoin(domains, and(
      eq(domains.id, domainProviderBindings.domainId),
      eq(domains.workspaceId, domainProviderBindings.workspaceId),
    ))
    .where(eq(domainProviderBindings.id, bindingId))
    .limit(1);
  if (!row || row.binding.status === "disabled") throw new Error("Domain binding is unavailable");
  try {
    const result = row.binding.provider === "postmark"
      ? await checkPostmarkDomain(row.binding.externalDomainId ?? "")
      : await checkSesDomain(row.domain.name).then((ses) => ({
        dkimStatus: ses.dkimStatus,
        returnPathStatus: ses.mailFromStatus,
        status: ses.status === "verified" ? ("verified" as const) : ("dns_pending" as const),
      }));
    const now = new Date();
    await db.update(domainProviderBindings).set({
      ...result,
      lastCheckError: null,
      lastCheckedAt: now,
      updatedAt: now,
      verifiedAt: result.status === "verified" ? row.binding.verifiedAt ?? now : null,
    }).where(and(eq(domainProviderBindings.id, row.binding.id), eq(domainProviderBindings.workspaceId, row.binding.workspaceId)));
    return result;
  } catch (error) {
    const code = error instanceof Error && error.message ? error.message.slice(0, 500) : "Domain check failed";
    await db.update(domainProviderBindings).set({ lastCheckError: code, lastCheckedAt: new Date(), updatedAt: new Date() }).where(and(eq(domainProviderBindings.id, row.binding.id), eq(domainProviderBindings.workspaceId, row.binding.workspaceId)));
    throw error;
  }
}
