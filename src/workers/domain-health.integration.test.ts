import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ ses: vi.fn(), postmark: vi.fn() }));
vi.mock("@/workers/runtime-secrets", () => ({ loadRuntimeSecrets: async () => {} }));
vi.mock("@/features/domains/check-domain", () => ({ checkSesDomain: dependencies.ses }));
vi.mock("@/features/domains/check-postmark-domain", () => ({ checkPostmarkDomain: dependencies.postmark }));

import { databasePool, requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, messages, transactionalProfiles, usageLedger, workspaces } from "@/db/schema";
import { workspaceReadinessSql } from "@/features/operations/readiness-query";
import { checkBinding, handler } from "./domain-health";

const db = requireDb();
let workspaceId: string;

async function seedBinding(index: number, lastCheckedAt: Date | null = null) {
  const [domain] = await db.insert(domains).values({
    workspaceId, name: `domain-${index}.example.test`,
  }).returning();
  const [binding] = await db.insert(domainProviderBindings).values({
    workspaceId, domainId: domain.id, provider: "ses", status: "verified", lastCheckedAt,
  }).returning();
  return binding;
}

beforeEach(async () => {
  // The suite setup rejects non-local databases; only this suite's fixture rows are removed.
  if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  workspaceId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "Domain health test", slug: `health-${workspaceId}` });
  dependencies.ses.mockReset().mockResolvedValue({ dkimStatus: "verified", mailFromStatus: "verified", dmarcStatus: "verified", status: "verified" });
  dependencies.postmark.mockReset();
});

afterAll(async () => {
  if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  await databasePool!.end();
});

async function readBinding(id: string) {
  const [binding] = await db.select().from(domainProviderBindings).where(and(
    eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, id),
  ));
  return binding;
}

describe("domain health scheduling and workspace isolation", () => {
  it("detects a mismatched message ledger even when totals match, and scopes the audit", async () => {
    const binding = await seedBinding(0);
    const [profile] = await db.insert(transactionalProfiles).values({
      workspaceId, key: "receipt", name: "Receipt", triggerDescription: "Purchase", recipientRelationship: "Customer", contentExample: "Receipt",
    }).returning();
    const rows = await db.insert(messages).values([true, false].map((accepted) => ({
      workspaceId, domainId: binding.domainId, transactionalProfileId: profile.id,
      provider: "ses" as const, contentKind: "template" as const, stream: "transactional" as const,
      sendMode: "live" as const, status: "sent" as const, fromEmail: "sender@example.test", toEmail: "recipient@example.test",
      subject: "Synthetic test", html: "<p>Test</p>", plainText: "Test", providerAcceptedAt: accepted ? new Date() : null,
    }))).returning();
    await db.insert(usageLedger).values({ workspaceId, messageId: rows[1].id, acceptedAt: new Date() });
    const own = await databasePool!.query(workspaceReadinessSql, [workspaceId]);
    expect(own.rows[0]).toMatchObject({ provider_accepted: "1", ledger_rows: "1", ledger_mismatches: "2" });
    const other = await databasePool!.query(workspaceReadinessSql, [randomUUID()]);
    expect(other.rows[0]).toMatchObject({ provider_accepted: "0", ledger_rows: "0", ledger_mismatches: "0", approved_workspaces: "0" });
  });
  it("leaves unchecked candidates for the next invocation when the worker deadline approaches", async () => {
    const binding = await seedBinding(0);
    await expect(handler({}, { getRemainingTimeInMillis: () => 19_999 })).resolves.toEqual({ checked: 0 });
    expect(dependencies.ses).not.toHaveBeenCalled();
    expect((await readBinding(binding.id)).lastCheckedAt).toBeNull();
  });
  it("rotates across more than 50 bindings instead of starving later rows", async () => {
    const bindings = [];
    for (let index = 0; index < 55; index++) bindings.push(await seedBinding(index));
    await expect(handler()).resolves.toEqual({ checked: 50 });
    await expect(handler()).resolves.toEqual({ checked: 50 });
    for (const binding of bindings) expect((await readBinding(binding.id)).lastCheckedAt).toBeInstanceOf(Date);
    expect(new Set(dependencies.ses.mock.calls.map(([domain]) => domain)).size).toBe(55);
  });

  it("advances failed checks too, without persisting provider content", async () => {
    const binding = await seedBinding(0);
    dependencies.ses.mockRejectedValue(new Error("private-recipient@example.test private body"));
    await expect(checkBinding(workspaceId, binding.id)).rejects.toThrow("domain_check_failed");
    expect(await readBinding(binding.id)).toMatchObject({ lastCheckError: "domain_check_failed", lastCheckedAt: expect.any(Date) });
  });

  it("rejects a binding from another workspace before calling a provider", async () => {
    const binding = await seedBinding(0);
    await expect(checkBinding(randomUUID(), binding.id)).rejects.toThrow("unavailable");
    expect(dependencies.ses).not.toHaveBeenCalled();
    expect((await readBinding(binding.id)).lastCheckedAt).toBeNull();
  });

  it("persists SES DMARC status and never revives a concurrently disabled binding", async () => {
    const binding = await seedBinding(0);
    await checkBinding(workspaceId, binding.id);
    expect((await readBinding(binding.id)).dmarcStatus).toBe("verified");
    dependencies.ses.mockImplementationOnce(async () => {
      await db.update(domainProviderBindings).set({ status: "disabled" }).where(and(
        eq(domainProviderBindings.workspaceId, workspaceId), eq(domainProviderBindings.id, binding.id),
      ));
      return { dkimStatus: "verified", mailFromStatus: "verified", dmarcStatus: "verified", status: "verified" };
    });
    await checkBinding(workspaceId, binding.id);
    expect((await readBinding(binding.id)).status).toBe("disabled");
    await expect(checkBinding(workspaceId, binding.id)).rejects.toThrow("unavailable");
  });
});
