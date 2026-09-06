import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ queue: vi.fn(), provision: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/page-auth", () => ({ requireAdmin: async () => ({ userId: "synthetic-admin" }) }));
vi.mock("@/lib/aws", () => ({ enqueueProviderProvisioning: calls.queue }));
vi.mock("@/workers/provider-provisioning", () => ({ provisionBinding: calls.provision }));

import { databasePool, requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, workspaces } from "@/db/schema";
import { provisionDomainAction } from "./actions";

const db = requireDb();
let workspaceId: string;
let domainId: string;
beforeEach(async () => {
  workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "Provisioning request", slug: workspaceId, status: "approved" });
  const [domain] = await db.insert(domains).values({ workspaceId, name: `${workspaceId}.example.test` }).returning();
  domainId = domain.id;
  vi.stubEnv("SES_ENABLED", "true");
  vi.stubEnv("POSTMARK_ENABLED", "true");
  calls.queue.mockReset().mockResolvedValue({ local: false });
  calls.provision.mockReset().mockResolvedValue("provisioned");
});
afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  vi.unstubAllEnvs();
});
afterAll(async () => { await databasePool!.end(); });

describe("administrator provider provisioning request", () => {
  it("passes the workspace to the queue and explicit local fallback", async () => {
    calls.queue.mockResolvedValue({ local: true });
    await provisionDomainAction(domainId, "ses");
    const [binding] = await db.select().from(domainProviderBindings).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.domainId, domainId)));
    expect(calls.queue).toHaveBeenCalledWith(workspaceId, binding.id);
    expect(calls.provision).toHaveBeenCalledWith(workspaceId, binding.id);
  });

  it.each(["disabled", "verified", "dns_pending"] as const)("does not reset a %s binding", async (status) => {
    const [binding] = await db.insert(domainProviderBindings).values({ workspaceId, domainId, provider: "ses", status }).returning();
    await expect(provisionDomainAction(domainId, "ses")).rejects.toThrow("cannot be reset");
    const [saved] = await db.select().from(domainProviderBindings).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
    expect(saved.status).toBe(status);
    expect(calls.queue).not.toHaveBeenCalled();
  });

  it("allows retrying a failed inactive binding without changing its identity", async () => {
    const [binding] = await db.insert(domainProviderBindings).values({ workspaceId, domainId, provider: "postmark", status: "failed", lastCheckError: "technical_failure" }).returning();
    await provisionDomainAction(domainId, "postmark");
    expect(calls.queue).toHaveBeenCalledWith(workspaceId, binding.id);
    const [saved] = await db.select().from(domainProviderBindings).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
    expect(saved).toMatchObject({ status: "pending", isActive: false, lastCheckError: null });
  });

  it("refuses a disabled domain before creating a binding", async () => {
    await db.update(domains).set({ status: "disabled" }).where(and(eq(domains.workspaceId, workspaceId), eq(domains.id, domainId)));
    await expect(provisionDomainAction(domainId, "ses")).rejects.toThrow("available for provisioning");
    expect(calls.queue).not.toHaveBeenCalled();
    expect(await db.select().from(domainProviderBindings).where(eq(domainProviderBindings.workspaceId, workspaceId))).toHaveLength(0);
  });

  it("keeps the uncertain webhook marker on an administrator retry", async () => {
    const marker = "postmark_webhook_creation_requires_reconciliation";
    const [binding] = await db.insert(domainProviderBindings).values({ workspaceId, domainId, provider: "postmark", status: "failed", lastCheckError: marker }).returning();
    await provisionDomainAction(domainId, "postmark");
    const [saved] = await db.select().from(domainProviderBindings).where(and(eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id)));
    expect(saved).toMatchObject({ status: "pending", lastCheckError: marker });
  });
});
