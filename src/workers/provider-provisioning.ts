import type { Context, SQSBatchResponse, SQSEvent } from "aws-lambda";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, workspaceProviderAccounts, workspaces } from "@/db/schema";
import { provisionSesDomain, SES_REPUTATION_POLICY } from "@/features/domains/provision-ses-domain";
import { provisionPostmarkDomain } from "@/features/providers/provision-postmark";
import { POSTMARK_WEBHOOK_CREATE_UNCERTAIN } from "@/features/providers/provision-postmark";
import { parseProvisioningJob } from "@/features/providers/provisioning-job";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";
import { logWorkerResult } from "@/lib/worker-log";

class ProvisioningSuperseded extends Error {}

export async function provisionBinding(workspaceId: string, bindingId: string, signal = AbortSignal.timeout(35_000)) {
  parseProvisioningJob({ workspaceId, bindingId });
  signal.throwIfAborted();
  const db = requireDb();
  // Transaction-scoped advisory locks work with transaction pooling. This
  // connection holds only the lock; checkpoints use separate short transactions
  // so the HTTP verification callback can read committed account credentials.
  return db.transaction(async (lock) => {
    await lock.execute(sql`set local idle_in_transaction_session_timeout = '60s'`);
    const result = await lock.execute<{ acquired: boolean }>(sql`select pg_try_advisory_xact_lock(hashtextextended(${`yodev-mail:provider-provisioning:${workspaceId}`}, 0)) as acquired`);
    if (!result.rows[0]?.acquired) throw new Error("provider_provisioning_busy");
    return provisionLockedBinding(workspaceId, bindingId, signal);
  });
}

async function provisionLockedBinding(workspaceId: string, bindingId: string, signal: AbortSignal) {
  signal.throwIfAborted();
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
        signal,
        webhookCreationAttempted: row.binding.lastCheckError === POSTMARK_WEBHOOK_CREATE_UNCERTAIN,
        beforeWebhookCreate: async () => {
          signal.throwIfAborted();
          const marked = await db.update(domainProviderBindings).set({ lastCheckError: POSTMARK_WEBHOOK_CREATE_UNCERTAIN, updatedAt: new Date() }).where(writable).returning({ id: domainProviderBindings.id });
          if (!marked.length) throw new ProvisioningSuperseded();
        },
        existingAccount: account
          ? { externalAccountId: account.externalAccountId, credentialParameterName: account.credentialParameterName }
          : undefined,
        checkpoint: async (state) => {
          signal.throwIfAborted();
          await db.transaction(async (tx) => {
            await tx.execute(sql`set local statement_timeout = '5s'`);
            const eligible = await tx.update(domainProviderBindings).set({ updatedAt: new Date() }).where(writable).returning({ id: domainProviderBindings.id });
            if (!eligible.length) throw new ProvisioningSuperseded();
            const persisted = await tx.insert(workspaceProviderAccounts).values({ workspaceId, provider: "postmark", status: "pending", ...state }).onConflictDoUpdate({
              target: [workspaceProviderAccounts.workspaceId, workspaceProviderAccounts.provider],
              set: { ...state, status: sql`case when ${workspaceProviderAccounts.status} = 'ready' then 'ready'::provider_account_status else 'pending'::provider_account_status end`, updatedAt: new Date() },
              setWhere: and(
                eq(workspaceProviderAccounts.workspaceId, workspaceId), inArray(workspaceProviderAccounts.status, ["pending", "failed", "ready"]),
                state.externalAccountId ? or(isNull(workspaceProviderAccounts.externalAccountId), eq(workspaceProviderAccounts.externalAccountId, state.externalAccountId)) : undefined,
                state.credentialParameterName ? or(isNull(workspaceProviderAccounts.credentialParameterName), eq(workspaceProviderAccounts.credentialParameterName, state.credentialParameterName)) : undefined,
              ),
            }).returning({ id: workspaceProviderAccounts.id });
            if (!persisted.length) throw new ProvisioningSuperseded();
          });
        },
      }).then((value) => ({ ...value, mailFromDomain: `pm-bounces.${row.domain.name}`, reputationPolicy: null }))
      : await provisionSesDomain({ workspaceId, domain: row.domain.name, existingAccountId: account?.externalAccountId, signal }).then((value) => ({
        externalAccountId: value.tenantName, externalDomainId: value.identityArn, credentialParameterName: null,
        records: value.records, mailFromDomain: `bounce.${row.domain.name}`, reputationPolicy: SES_REPUTATION_POLICY,
      }));
    return await db.transaction(async (tx) => {
      signal.throwIfAborted();
      await tx.execute(sql`set local statement_timeout = '5s'`);
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
        setWhere: and(
          eq(workspaceProviderAccounts.workspaceId, workspaceId), inArray(workspaceProviderAccounts.status, ["pending", "failed", "ready"]),
          or(isNull(workspaceProviderAccounts.externalAccountId), eq(workspaceProviderAccounts.externalAccountId, result.externalAccountId)),
        ),
      }).returning({ id: workspaceProviderAccounts.id });
      if (!saved.length) throw new ProvisioningSuperseded();
      return "provisioned";
    });
  } catch (error) {
    if (error instanceof ProvisioningSuperseded) return "skipped";
    const code = "provider_provisioning_failed";
    await db.update(domainProviderBindings).set({ status: "failed", lastCheckError: sql`case when ${domainProviderBindings.lastCheckError} = ${POSTMARK_WEBHOOK_CREATE_UNCERTAIN} then ${POSTMARK_WEBHOOK_CREATE_UNCERTAIN} else ${code} end`, updatedAt: new Date() }).where(writable);
    throw new Error(code);
  }
}

export async function handler(event: SQSEvent, context?: Pick<Context, "getRemainingTimeInMillis">): Promise<SQSBatchResponse> {
  const budget = Math.max(1, Math.min(35_000, (context?.getRemainingTimeInMillis() ?? 45_000) - 10_000));
  const signal = AbortSignal.timeout(budget);
  await loadRuntimeSecrets(["DATABASE_URL"], signal);
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const job = parseProvisioningJob(JSON.parse(record.body));
      if (context && context.getRemainingTimeInMillis() < 11_000) throw new Error("provider_provisioning_deadline");
      await provisionBinding(job.workspaceId, job.bindingId, signal);
      logWorkerResult({ worker: "provider-provisioning", correlationId: record.messageId, outcome: "completed" });
    } catch {
      logWorkerResult({ worker: "provider-provisioning", correlationId: record.messageId, outcome: "failed", code: "technical_failure" });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
