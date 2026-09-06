import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Context } from "aws-lambda";
import { requireDb } from "@/db/runtime";
import { domainProviderBindings, domains } from "@/db/schema";
import { checkPostmarkDomain } from "@/features/domains/check-postmark-domain";
import { checkSesDomain } from "@/features/domains/check-domain";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler(_event?: unknown, context?: Pick<Context, "getRemainingTimeInMillis">) {
  await loadRuntimeSecrets();
  const db = requireDb();
  const candidates = await db.select({ binding: domainProviderBindings, domain: domains }).from(domainProviderBindings).innerJoin(domains, and(
    eq(domains.id, domainProviderBindings.domainId),
    eq(domains.workspaceId, domainProviderBindings.workspaceId),
  )).where(and(
    inArray(domainProviderBindings.status, ["dns_pending", "verified"]),
    isNotNull(domainProviderBindings.externalDomainId),
  ))
    .orderBy(sql`${domainProviderBindings.lastCheckedAt} asc nulls first`, asc(domainProviderBindings.id))
    .limit(50);
  let checked = 0;
  for (const { binding } of candidates) {
    // Leave time for the bounded provider/DNS request and database persistence.
    if (context && context.getRemainingTimeInMillis() < 20_000) break;
    try {
      await checkBinding(binding.workspaceId, binding.id);
      checked += 1;
    } catch { /* checkBinding persists a bounded operational error */ }
  }
  return { checked };
}

export async function checkBinding(workspaceId: string, bindingId: string) {
  await loadRuntimeSecrets();
  const db = requireDb();
  const [row] = await db.select({ binding: domainProviderBindings, domain: domains })
    .from(domainProviderBindings)
    .innerJoin(domains, and(
      eq(domains.id, domainProviderBindings.domainId),
      eq(domains.workspaceId, domainProviderBindings.workspaceId),
    ))
    .where(and(eq(domainProviderBindings.id, bindingId), eq(domainProviderBindings.workspaceId, workspaceId)))
    .limit(1);
  if (!row || !["dns_pending", "verified"].includes(row.binding.status) || !row.binding.externalDomainId) throw new Error("Domain binding is unavailable");
  try {
    const result = row.binding.provider === "postmark"
      ? await checkPostmarkDomain(row.binding.externalDomainId ?? "")
      : await checkSesDomain(row.domain.name).then((ses) => ({
        dkimStatus: ses.dkimStatus,
        dmarcStatus: ses.dmarcStatus,
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
    }).where(and(eq(domainProviderBindings.id, row.binding.id), eq(domainProviderBindings.workspaceId, workspaceId), inArray(domainProviderBindings.status, ["dns_pending", "verified"])));
    return result;
  } catch {
    // Provider diagnostics may contain addresses or content. Persist only a fixed code.
    const code = "domain_check_failed";
    await db.update(domainProviderBindings).set({ lastCheckError: code, lastCheckedAt: new Date(), updatedAt: new Date() }).where(and(eq(domainProviderBindings.id, row.binding.id), eq(domainProviderBindings.workspaceId, workspaceId), inArray(domainProviderBindings.status, ["dns_pending", "verified"])));
    throw new Error(code);
  }
}
