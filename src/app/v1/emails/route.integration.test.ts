import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

// Real API key authentication, real per-minute limiter and real idempotency
// table: only the environment is fixed for the run.
vi.hoisted(() => {
  process.env.API_KEY_PEPPER = "integration-pepper-not-a-secret-0001";
  process.env.LIVE_EMAIL_ACCEPTANCE_ENABLED = "false";
  process.env.CUSTOMER_WEBHOOKS_ENABLED = "false";
  process.env.ATTACHMENTS_ENABLED = "false";
  process.env.RAW_EMAIL_ENABLED = "false";
});
vi.mock("server-only", () => ({}));

import { POST } from "@/app/v1/emails/route";
import { databasePool, requireDb } from "@/db/runtime";
import {
  apiKeys,
  apiRateLimits,
  domainProviderBindings,
  domains,
  messages,
  subscriptions,
  templates,
  templateVersions,
  transactionalProfiles,
  workspaceProviderAccounts,
  workspaces,
} from "@/db/schema";
import { createApiKey } from "@/lib/crypto";

const db = requireDb();
const pool = databasePool!;

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  const names = result.rows.map(({ tablename }) => tablename).filter((name) => /^[a-z0-9_]+$/.test(name)).map((name) => `"${name}"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function seed() {
  const workspaceId = randomUUID();
  const domainId = randomUUID();
  const profileId = randomUUID();
  const templateId = randomUUID();
  await db.insert(workspaces).values({ id: workspaceId, name: "API Workspace", slug: `api-${workspaceId.slice(0, 8)}`, status: "approved" });
  await db.insert(subscriptions).values({ workspaceId, pilotAccessExpiresAt: new Date(Date.now() + 86_400_000) });
  await db.insert(domains).values({ id: domainId, workspaceId, name: "example.com", status: "verified", dkimStatus: "verified", activeProvider: "postmark" });
  await db.insert(domainProviderBindings).values({ workspaceId, domainId, provider: "postmark", status: "verified", dkimStatus: "verified", isActive: true });
  await db.insert(workspaceProviderAccounts).values({ workspaceId, provider: "postmark", status: "ready", externalAccountId: "server-1", credentialParameterName: "/test/postmark/server-token" });
  await db.insert(transactionalProfiles).values({
    id: profileId, workspaceId, key: "receipt", name: "Receipt", status: "approved",
    triggerDescription: "A purchase made by the recipient triggers this message.",
    recipientRelationship: "The recipient is the customer who made the purchase.",
    contentExample: "Purchase receipt",
  });
  await db.insert(templates).values({ id: templateId, workspaceId, transactionalProfileId: profileId, name: "Receipt", subject: "Receipt {{order}}", reviewStatus: "approved" });
  await db.insert(templateVersions).values({ workspaceId, templateId, version: 1, document: { version: 1, blocks: [] }, html: "<p>{{order}}</p>", plainText: "{{order}}", createdBy: "integration-test" });
  const key = createApiKey("test", process.env.API_KEY_PEPPER!);
  await db.insert(apiKeys).values({ workspaceId, name: "Integration", mode: "test", prefix: key.prefix, secretHash: key.secretHash, scopes: ["emails:send", "emails:read"], createdBy: "integration-test" });
  return { workspaceId, templateId, token: key.token };
}

function request(token: string, idempotencyKey: string, body: Record<string, unknown>) {
  return new Request("https://api.mail.yodev.fr/v1/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function emailBody(templateId: string, extra: Record<string, unknown> = {}) {
  return { category: "receipt", content: { templateId, variables: { order: "A-1" } }, from: { email: "sender@example.com" }, to: { email: "recipient@example.net" }, ...extra };
}

async function consumedRequests(workspaceId: string) {
  const rows = await db.select({ count: apiRateLimits.requestCount }).from(apiRateLimits).where(eq(apiRateLimits.workspaceId, workspaceId));
  return rows.reduce((sum, row) => sum + row.count, 0);
}

describe("POST /v1/emails against PostgreSQL", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await pool.end();
  });

  it("does not charge idempotent retries to the per-minute limit, but charges every new key", async () => {
    // Freeze the clock inside one rate-limit minute so the count cannot split.
    vi.useFakeTimers({ toFake: ["Date"], now: Math.floor(Date.now() / 60_000) * 60_000 + 1_000 });
    onTestFinished(() => { vi.useRealTimers(); });
    const context = await seed();
    const first = await POST(request(context.token, "order-A-1", emailBody(context.templateId)));
    expect(first.status).toBe(202);
    const { data } = await first.json();
    expect(data.status).toBe("simulated");

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const retry = await POST(request(context.token, "order-A-1", emailBody(context.templateId)));
      expect(retry.status).toBe(202);
      expect((await retry.json()).data.id).toBe(data.id);
    }
    expect(await consumedRequests(context.workspaceId)).toBe(1);
    // A different body under the same key is still a conflict, and still free.
    const conflict = await POST(request(context.token, "order-A-1", emailBody(context.templateId, { to: { email: "other@example.net" } })));
    expect(conflict.status).toBe(409);
    expect(await consumedRequests(context.workspaceId)).toBe(1);

    // Test keys allow 10 new requests per minute: 9 more new keys pass, the next is refused.
    for (let index = 2; index <= 10; index += 1) {
      expect((await POST(request(context.token, `order-A-${index}`, emailBody(context.templateId)))).status).toBe(202);
    }
    expect((await POST(request(context.token, "order-A-11", emailBody(context.templateId)))).status).toBe(429);
    const stored = await db.select({ id: messages.id }).from(messages).where(eq(messages.workspaceId, context.workspaceId));
    expect(stored).toHaveLength(10);
  });

  it("refuses a trapped display name with 422 and stores nothing", async () => {
    const context = await seed();
    const response = await POST(request(context.token, "trap", emailBody(context.templateId, { to: { email: "recipient@example.net", name: "x@other.test, Bob" } })));
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("invalid_request");
    expect(await db.select().from(messages).where(eq(messages.workspaceId, context.workspaceId))).toHaveLength(0);
  });

  it("rejects the API keys of a soft-deleted workspace", async () => {
    const context = await seed();
    expect((await POST(request(context.token, "before-delete", emailBody(context.templateId)))).status).toBe(202);
    await db.update(workspaces).set({ deletedAt: new Date() }).where(eq(workspaces.id, context.workspaceId));
    const response = await POST(request(context.token, "after-delete", emailBody(context.templateId)));
    expect(response.status).toBe(401);
    // The key row itself was not revoked: only the workspace state refuses it.
    const [key] = await db.select().from(apiKeys).where(and(eq(apiKeys.workspaceId, context.workspaceId)));
    expect(key.revokedAt).toBeNull();
  });

  it("refuses an inflated template variable with 422", async () => {
    const context = await seed();
    const response = await POST(request(context.token, "inflated", emailBody(context.templateId, {
      content: { templateId: context.templateId, variables: { order: randomBytes(2_000).toString("hex") } },
    })));
    expect(response.status).toBe(422);
  });
});
