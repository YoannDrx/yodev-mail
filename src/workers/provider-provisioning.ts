import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, workspaceProviderAccounts, workspaces } from "@/db/schema";
import { provisionSesDomain } from "@/features/domains/provision-ses-domain";
import { provisionPostmarkDomain } from "@/features/providers/provision-postmark";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";
import { logWorkerResult } from "@/lib/worker-log";

export async function provisionBinding(bindingId: string) {
  const db = requireDb();
  const [row] = await db.select({ binding: domainProviderBindings, domain: domains, workspace: workspaces })
    .from(domainProviderBindings)
    .innerJoin(domains, and(eq(domains.id, domainProviderBindings.domainId), eq(domains.workspaceId, domainProviderBindings.workspaceId)))
    .innerJoin(workspaces, eq(workspaces.id, domainProviderBindings.workspaceId))
    .where(eq(domainProviderBindings.id, bindingId)).limit(1);
  if (!row || row.workspace.status !== "approved") return;
  try {
    if (row.binding.provider === "postmark") {
      if (process.env.POSTMARK_ENABLED !== "true") throw new Error("Postmark is not enabled");
      const [existing] = await db.select().from(workspaceProviderAccounts).where(and(
        eq(workspaceProviderAccounts.workspaceId, row.workspace.id),
        eq(workspaceProviderAccounts.provider, "postmark"),
      )).limit(1);
      const result = await provisionPostmarkDomain({
        environment: process.env.DEPLOYMENT_ENVIRONMENT === "prod" ? "prod" : "dev",
        workspaceId: row.workspace.id,
        workspaceName: row.workspace.name,
        bindingId: row.binding.id,
        domain: row.domain.name,
        existingAccount: existing?.externalAccountId && existing.credentialParameterName
          ? { externalAccountId: existing.externalAccountId, credentialParameterName: existing.credentialParameterName }
          : undefined,
      });
      await db.transaction(async (tx) => {
        await tx.insert(workspaceProviderAccounts).values({ workspaceId: row.workspace.id, provider: "postmark", status: "ready", externalAccountId: result.externalAccountId, credentialParameterName: result.credentialParameterName }).onConflictDoUpdate({
          target: [workspaceProviderAccounts.workspaceId, workspaceProviderAccounts.provider],
          set: { status: "ready", externalAccountId: result.externalAccountId, credentialParameterName: result.credentialParameterName, updatedAt: new Date() },
        });
        await tx.update(domainProviderBindings).set({ externalDomainId: result.externalDomainId, mailFromDomain: `pm-bounces.${row.domain.name}`, dnsRecords: result.records, status: "dns_pending", updatedAt: new Date() }).where(eq(domainProviderBindings.id, row.binding.id));
      });
    } else {
      if (process.env.SES_ENABLED !== "true") throw new Error("SES is disabled until AWS production approval");
      const result = await provisionSesDomain({ workspaceId: row.workspace.id, domain: row.domain.name });
      await db.transaction(async (tx) => {
        await tx.insert(workspaceProviderAccounts).values({ workspaceId: row.workspace.id, provider: "ses", status: "ready", externalAccountId: result.tenantName, reputationPolicy: "strict" }).onConflictDoUpdate({
          target: [workspaceProviderAccounts.workspaceId, workspaceProviderAccounts.provider],
          set: { status: "ready", externalAccountId: result.tenantName, reputationPolicy: "strict", updatedAt: new Date() },
        });
        await tx.update(domainProviderBindings).set({ externalDomainId: `arn:aws:ses:${process.env.AWS_REGION ?? "eu-west-3"}:${process.env.AWS_ACCOUNT_ID ?? ""}:identity/${row.domain.name}`, mailFromDomain: `bounce.${row.domain.name}`, dnsRecords: result.records, status: "dns_pending", updatedAt: new Date() }).where(eq(domainProviderBindings.id, row.binding.id));
      });
    }
  } catch (error) {
    await db.update(domainProviderBindings).set({
      status: "failed",
      lastCheckError: error instanceof Error ? error.message.slice(0, 500) : "Provisioning failed",
      updatedAt: new Date(),
    }).where(eq(domainProviderBindings.id, row.binding.id));
    throw error;
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await provisionBinding(JSON.parse(record.body).bindingId);
      logWorkerResult({ worker: "provider-provisioning", correlationId: record.messageId, outcome: "completed" });
    } catch {
      logWorkerResult({ worker: "provider-provisioning", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
