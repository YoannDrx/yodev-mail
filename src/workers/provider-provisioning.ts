import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, workspaceProviderAccounts, workspaces } from "@/db/schema";
import { provisionSesDomain, SES_REPUTATION_POLICY } from "@/features/domains/provision-ses-domain";
import { provisionPostmarkDomain } from "@/features/providers/provision-postmark";
import { parseProvisioningJob } from "@/features/providers/provisioning-job";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";
import { logWorkerResult } from "@/lib/worker-log";

class ProvisioningSuperseded extends Error {}

export async function provisionBinding(workspaceId: string, bindingId: string) {
  parseProvisioningJob({ workspaceId, bindingId });
  const db = requireDb();
  const [row] = await db.select({ binding: domainProviderBindings, domain: domains, workspace: workspaces })
    .from(domainProviderBindings)
    .innerJoin(domains, and(eq(domains.id, domainProviderBindings.domainId), eq(domains.workspaceId, domainProviderBindings.workspaceId)))
    .innerJoin(workspaces, eq(workspaces.id, domainProviderBindings.workspaceId))
    .where(and(eq(domainProviderBindings.id, bindingId), eq(domainProviderBindings.workspaceId, workspaceId))).limit(1);
  if (!row) throw new Error("provider_binding_unavailable");
  if (row.workspace.status !== "approved" || row.workspace.deletedAt || row.domain.status === "disabled"
    || row.binding.isActive || !["pending", "failed"].includes(row.binding.status)) return "skipped";
  const [account] = await db.select().from(workspaceProviderAccounts).where(and(
    eq(workspaceProviderAccounts.workspaceId, workspaceId), eq(workspaceProviderAccounts.provider, row.binding.provider),
  )).limit(1);
  if (account && ["paused", "disabled"].includes(account.status)) return "skipped";
  if ((row.binding.provider === "ses" ? process.env.SES_ENABLED : process.env.POSTMARK_ENABLED) !== "true") {
    throw new Error("provider_provisioning_disabled");
  }

  // Re-evaluate authority in the write statement after the external request.
  const writable = and(
    eq(domainProviderBindings.id, bindingId), eq(domainProviderBindings.workspaceId, workspaceId),
    eq(domainProviderBindings.isActive, false), inArray(domainProviderBindings.status, ["pending", "failed"]),
    sql`exists (select 1 from ${workspaces} where ${workspaces.id} = ${workspaceId} and ${workspaces.status} = 'approved' and ${workspaces.deletedAt} is null)`,
    sql`exists (select 1 from ${domains} where ${domains.id} = ${row.domain.id} and ${domains.workspaceId} = ${workspaceId} and ${domains.status} <> 'disabled')`,
    sql`not exists (select 1 from ${workspaceProviderAccounts} where ${workspaceProviderAccounts.workspaceId} = ${workspaceId} and ${workspaceProviderAccounts.provider} = ${row.binding.provider} and ${workspaceProviderAccounts.status} in ('paused', 'disabled'))`,
  );
  try {
    const result = row.binding.provider === "postmark"
      ? await provisionPostmarkDomain({
        environment: process.env.DEPLOYMENT_ENVIRONMENT === "prod" ? "prod" : "dev",
        workspaceId, workspaceName: row.workspace.name, bindingId, domain: row.domain.name,
        existingAccount: account?.externalAccountId && account.credentialParameterName
          ? { externalAccountId: account.externalAccountId, credentialParameterName: account.credentialParameterName }
          : undefined,
      }).then((value) => ({ ...value, mailFromDomain: `pm-bounces.${row.domain.name}`, reputationPolicy: null }))
      : await provisionSesDomain({ workspaceId, domain: row.domain.name }).then((value) => ({
        externalAccountId: value.tenantName, externalDomainId: value.identityArn, credentialParameterName: null,
        records: value.records, mailFromDomain: `bounce.${row.domain.name}`, reputationPolicy: SES_REPUTATION_POLICY,
      }));
    return await db.transaction(async (tx) => {
      const updated = await tx.update(domainProviderBindings).set({
        externalDomainId: result.externalDomainId, mailFromDomain: result.mailFromDomain,
        dnsRecords: result.records, status: "dns_pending", lastCheckError: null, updatedAt: new Date(),
      }).where(writable).returning({ id: domainProviderBindings.id });
      if (!updated.length) return "skipped";
      const accountValues = {
        status: "ready" as const, externalAccountId: result.externalAccountId,
        credentialParameterName: result.credentialParameterName, reputationPolicy: result.reputationPolicy,
        updatedAt: new Date(),
      };
      const saved = await tx.insert(workspaceProviderAccounts).values({
        workspaceId, provider: row.binding.provider, ...accountValues,
      }).onConflictDoUpdate({
        target: [workspaceProviderAccounts.workspaceId, workspaceProviderAccounts.provider],
        set: accountValues,
        setWhere: and(eq(workspaceProviderAccounts.workspaceId, workspaceId), inArray(workspaceProviderAccounts.status, ["pending", "failed", "ready"])),
      }).returning({ id: workspaceProviderAccounts.id });
      if (!saved.length) throw new ProvisioningSuperseded();
      return "provisioned";
    });
  } catch (error) {
    if (error instanceof ProvisioningSuperseded) return "skipped";
    const code = "provider_provisioning_failed";
    await db.update(domainProviderBindings).set({ status: "failed", lastCheckError: code, updatedAt: new Date() }).where(writable);
    throw new Error(code);
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const job = parseProvisioningJob(JSON.parse(record.body));
      await provisionBinding(job.workspaceId, job.bindingId);
      logWorkerResult({ worker: "provider-provisioning", correlationId: record.messageId, outcome: "completed" });
    } catch {
      logWorkerResult({ worker: "provider-provisioning", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
