import { randomUUID } from "node:crypto";
import type { SQSEvent } from "aws-lambda";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ ses: vi.fn(), postmark: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/worker-log", () => ({ logWorkerResult: providers.log }));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: async () => {} }));
vi.mock("@/features/domains/provision-ses-domain", () => ({ provisionSesDomain: providers.ses, SES_REPUTATION_POLICY: "standard" }));
vi.mock("@/features/providers/provision-postmark", () => ({ provisionPostmarkDomain: providers.postmark, POSTMARK_WEBHOOK_CREATE_UNCERTAIN: "postmark_webhook_creation_requires_reconciliation" }));

import { databasePool, requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, workspaceProviderAccounts, workspaces } from "@/db/schema";
import { handler, provisionBinding } from "./provider-provisioning";

const db = requireDb();
let workspaceId: string;
beforeEach(async () => {
  workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "Provisioning test", slug: workspaceId, status: "approved" });
  vi.stubEnv("SES_ENABLED", "true");
  vi.stubEnv("POSTMARK_ENABLED", "true");
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "prod");
  providers.log.mockReset();
  providers.ses.mockReset().mockResolvedValue({ tenantName: `ym-prod-${workspaceId}`, identityArn: "arn:aws:ses:eu-west-3:123456789012:identity/example.test", records: [] });
  providers.postmark.mockReset().mockResolvedValue({ externalAccountId: "42", externalDomainId: "43", credentialParameterName: `/synthetic/${workspaceId}/server-token`, records: [] });
});
afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  vi.unstubAllEnvs();
});
afterAll(async () => { await databasePool!.end(); });

async function seed(provider: "ses" | "postmark" = "ses") {
  const [domain] = await db.insert(domains).values({ workspaceId, name: `${randomUUID()}.example.test` }).returning();
  const [binding] = await db.insert(domainProviderBindings).values({ workspaceId, domainId: domain.id, provider }).returning();
  return binding;
}
async function read(id: string) {
  return (await db.select().from(domainProviderBindings).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, id))))[0];
}

describe("provider provisioning state safety", () => {
  it("passes the existing SES account to the environment preflight without replacing it on rejection", async () => {
    const binding = await seed();
    const externalAccountId = `ym-dev-${workspaceId}`;
    await db.insert(workspaceProviderAccounts).values({ workspaceId, provider: "ses", status: "ready", externalAccountId });
    providers.ses.mockRejectedValueOnce(new Error("ses_account_mismatch"));
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_failed");
    expect(providers.ses.mock.calls[0][0]).toMatchObject({ workspaceId, existingAccountId: externalAccountId });
    const [saved] = await db.select().from(workspaceProviderAccounts).where(and(eq(workspaceProviderAccounts.workspaceId, workspaceId), eq(workspaceProviderAccounts.provider, "ses")));
    expect(saved).toMatchObject({ externalAccountId, status: "ready" });
    expect(await read(binding.id)).toMatchObject({ status: "failed", externalDomainId: null });
  });

  it.each(["ses", "postmark"] as const)("does not overwrite a concurrently changed %s account or persist a mixed binding", async (provider) => {
    const binding = await seed(provider);
    providers[provider].mockImplementationOnce(async () => {
      await db.insert(workspaceProviderAccounts).values({ workspaceId, provider, status: "ready", externalAccountId: "concurrent-account" });
      return provider === "ses"
        ? { tenantName: `ym-prod-${workspaceId}`, identityArn: "synthetic-identity", records: [] }
        : { externalAccountId: "42", externalDomainId: "43", credentialParameterName: "/synthetic/server-token", records: [] };
    });
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("skipped");
    expect(await read(binding.id)).toMatchObject({ status: "pending", externalDomainId: null });
    const [saved] = await db.select().from(workspaceProviderAccounts).where(and(eq(workspaceProviderAccounts.workspaceId, workspaceId), eq(workspaceProviderAccounts.provider, provider)));
    expect(saved).toMatchObject({ externalAccountId: "concurrent-account", status: "ready" });
  });

  it("serializes concurrent domains in a workspace and releases the lock after completion", async () => {
    const first = await seed("postmark");
    const second = await seed("postmark");
    let announce!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { announce = resolve; });
    const blocked = new Promise<void>(resolve => { release = resolve; });
    providers.postmark.mockImplementationOnce(async () => {
      announce();
      await blocked;
      return { externalAccountId: "42", externalDomainId: "43", credentialParameterName: `/synthetic/${workspaceId}/server-token`, records: [] };
    });
    const active = provisionBinding(workspaceId, first.id);
    try {
      await entered;
      await expect(provisionBinding(workspaceId, second.id)).rejects.toThrow("provider_provisioning_busy");
      expect(providers.postmark).toHaveBeenCalledOnce();
    } finally { release(); await active; }
    await expect(provisionBinding(workspaceId, second.id)).resolves.toBe("provisioned");
    expect(providers.postmark).toHaveBeenCalledTimes(2);
  });

  it("commits account checkpoints before the callback and preserves them after failure", async () => {
    const binding = await seed("postmark");
    const credentialParameterName = `/synthetic/${workspaceId}/server-token`;
    providers.postmark.mockImplementationOnce(async (input) => {
      await input.checkpoint({});
      await input.checkpoint({ externalAccountId: "42" });
      await input.checkpoint({ externalAccountId: "42", credentialParameterName });
      const [saved] = await db.select().from(workspaceProviderAccounts).where(and(eq(workspaceProviderAccounts.workspaceId, workspaceId), eq(workspaceProviderAccounts.provider, "postmark")));
      expect(saved).toMatchObject({ status: "pending", externalAccountId: "42", credentialParameterName });
      expect((await read(binding.id)).externalDomainId).toBeNull();
      await input.beforeWebhookCreate();
      throw new Error("synthetic uncertain webhook result");
    });
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_failed");
    expect(await read(binding.id)).toMatchObject({ status: "failed", lastCheckError: "postmark_webhook_creation_requires_reconciliation" });
    await provisionBinding(workspaceId, binding.id);
    expect(providers.postmark.mock.calls[1][0]).toMatchObject({ existingAccount: { externalAccountId: "42", credentialParameterName }, webhookCreationAttempted: true });
  });

  it("persists uncertain server intent without credentials on failure", async () => {
    const binding = await seed("postmark");
    providers.postmark.mockImplementationOnce(async (input) => { await input.checkpoint({}); throw new Error("synthetic uncertain server result"); });
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_failed");
    await provisionBinding(workspaceId, binding.id);
    expect(providers.postmark.mock.calls[1][0].existingAccount).toEqual({ externalAccountId: null, credentialParameterName: null });
  });

  it("preserves an already ready account during another domain checkpoint", async () => {
    const binding = await seed("postmark");
    await db.insert(workspaceProviderAccounts).values({ workspaceId, provider: "postmark", status: "ready", externalAccountId: "42", credentialParameterName: "/synthetic/server-token" });
    providers.postmark.mockImplementationOnce(async (input) => {
      await input.checkpoint({ externalAccountId: "42" });
      const [saved] = await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.workspaceId, workspaceId));
      expect(saved).toMatchObject({ status: "ready", credentialParameterName: "/synthetic/server-token" });
      throw new Error("synthetic later failure");
    });
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_failed");
  });

  it("does not checkpoint after a concurrent workspace suspension", async () => {
    const binding = await seed("postmark");
    providers.postmark.mockImplementationOnce(async (input) => {
      await db.update(workspaces).set({ status: "paused" }).where(eq(workspaces.id, workspaceId));
      await input.checkpoint({ externalAccountId: "42" });
      throw new Error("checkpoint_should_have_refused");
    });
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("skipped");
    expect(await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.workspaceId, workspaceId))).toHaveLength(0);
  });

  it("does not start provider work near the Lambda deadline", async () => {
    const binding = await seed();
    const event = { Records: [{ messageId: "deadline", body: JSON.stringify({ workspaceId, bindingId: binding.id }) }] } as SQSEvent;
    await expect(handler(event, { getRemainingTimeInMillis: () => 10_500 })).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "deadline" }] });
    expect(providers.ses).not.toHaveBeenCalled();
  });

  it.each(["ses", "postmark"] as const)("provisions %s once and does not downgrade a completed replay", async (provider) => {
    const binding = await seed(provider);
    await db.update(domainProviderBindings).set({ status: "failed", lastCheckError: "previous_failure" }).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("provisioned");
    expect(await read(binding.id)).toMatchObject({ status: "dns_pending", isActive: false, lastCheckError: null });
    const [account] = await db.select().from(workspaceProviderAccounts).where(and(eq(workspaceProviderAccounts.workspaceId, workspaceId), eq(workspaceProviderAccounts.provider, provider)));
    expect(account.status).toBe("ready");
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("skipped");
    expect(providers[provider]).toHaveBeenCalledTimes(1);
  });

  it("rejects another workspace before contacting a provider", async () => {
    const binding = await seed();
    await expect(provisionBinding(randomUUID(), binding.id)).rejects.toThrow("provider_binding_unavailable");
    expect(providers.ses).not.toHaveBeenCalled();
    expect((await read(binding.id)).status).toBe("pending");
  });

  it.each(["disabled", "verified", "dns_pending"] as const)("ignores a stale job for a %s binding", async (status) => {
    const binding = await seed();
    await db.update(domainProviderBindings).set({ status }).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("skipped");
    expect(providers.ses).not.toHaveBeenCalled();
    expect((await read(binding.id)).status).toBe(status);
  });

  it("respects the closed provider gate without rewriting the pending binding", async () => {
    const binding = await seed();
    vi.stubEnv("SES_ENABLED", "false");
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_disabled");
    expect(providers.ses).not.toHaveBeenCalled();
    expect((await read(binding.id)).status).toBe("pending");
  });

  it.each(["paused", "disabled"] as const)("does not reactivate a %s provider account", async (status) => {
    const binding = await seed("postmark");
    await db.insert(workspaceProviderAccounts).values({ workspaceId, provider: "postmark", status, externalAccountId: "42" });
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("skipped");
    expect(providers.postmark).not.toHaveBeenCalled();
  });

  it("persists and propagates only a fixed error code", async () => {
    const binding = await seed();
    providers.ses.mockRejectedValue(new Error("private-recipient@example.test private provider response"));
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_failed");
    expect((await read(binding.id)).lastCheckError).toBe("provider_provisioning_failed");
  });

  it("does not revive a binding disabled during provider access", async () => {
    const binding = await seed("postmark");
    providers.postmark.mockImplementationOnce(async () => {
      await db.update(domainProviderBindings).set({ status: "disabled" }).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
      return { externalAccountId: "42", externalDomainId: "43", credentialParameterName: "/synthetic/server-token", records: [] };
    });
    await provisionBinding(workspaceId, binding.id);
    expect((await read(binding.id)).status).toBe("disabled");
    expect(await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.workspaceId, workspaceId))).toHaveLength(0);
  });

  it.each(["workspace_paused", "workspace_deleted", "domain_disabled", "account_paused"] as const)("discards a late provider success after %s", async (change) => {
    const binding = await seed();
    providers.ses.mockImplementationOnce(async () => {
      if (change === "workspace_paused") await db.update(workspaces).set({ status: "paused" }).where(eq(workspaces.id, workspaceId));
      if (change === "workspace_deleted") await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, workspaceId));
      if (change === "domain_disabled") await db.update(domains).set({ status: "disabled" }).where(and(eq(domains.workspaceId, workspaceId), eq(domains.id, binding.domainId)));
      if (change === "account_paused") await db.insert(workspaceProviderAccounts).values({ workspaceId, provider: "ses", status: "paused", externalAccountId: "original" });
      return { tenantName: `ym-prod-${workspaceId}`, identityArn: "synthetic-identity", records: [] };
    });
    await expect(provisionBinding(workspaceId, binding.id)).resolves.toBe("skipped");
    expect((await read(binding.id)).externalDomainId).toBeNull();
    const accounts = await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.workspaceId, workspaceId));
    if (change === "account_paused") expect(accounts[0]).toMatchObject({ status: "paused", externalAccountId: "original" });
    else expect(accounts).toHaveLength(0);
  });

  it("does not overwrite a disabled binding with a late provider failure", async () => {
    const binding = await seed();
    providers.ses.mockImplementationOnce(async () => {
      await db.update(domainProviderBindings).set({ status: "disabled", lastCheckError: null }).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
      throw new Error("private provider diagnostic");
    });
    await expect(provisionBinding(workspaceId, binding.id)).rejects.toThrow("provider_provisioning_failed");
    expect(await read(binding.id)).toMatchObject({ status: "disabled", lastCheckError: null });
  });

  it("reports only failed SQS records and never logs an untrusted payload", async () => {
    const binding = await seed();
    const event = { Records: [
      { messageId: "valid", body: JSON.stringify({ workspaceId, bindingId: binding.id }) },
      { messageId: "legacy", body: JSON.stringify({ bindingId: binding.id }) },
      { messageId: "untrusted", body: JSON.stringify({ workspaceId, bindingId: binding.id, email: "private@example.test" }) },
    ] } as SQSEvent;
    await expect(handler(event)).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: "legacy" }, { itemIdentifier: "untrusted" }] });
    expect(providers.ses).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(providers.log.mock.calls)).not.toContain("private");
  });
});
