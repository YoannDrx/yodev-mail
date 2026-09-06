import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ values: new Map<string, string>(), send: vi.fn(), queue: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/aws", () => ({
  awsClients: async () => ({ ssm: { send: dependencies.send } }), enqueueProviderEvent: dependencies.queue,
}));
vi.mock("@/workers/runtime-secrets", () => ({
  loadRuntimeSecrets: async () => {},
  getSecureParameter: async (name: string) => {
    if (name.endsWith("/account-token")) return "synthetic-account-token";
    const value = dependencies.values.get(name);
    if (!value) throw new Error("synthetic_credential_missing");
    return value;
  },
}));

import { databasePool, requireDb } from "@/db/runtime";
import { domainProviderBindings, domains, workspaceProviderAccounts, workspaces } from "@/db/schema";
import { POST } from "@/app/api/providers/postmark/[bindingId]/route";
import { provisionBinding } from "./provider-provisioning";

const db = requireDb();
let workspaceId: string;
let bindingId: string;
let domainName: string;
let webhookExists = false;
let loseCreateResponse = false;
const verificationStatuses: number[] = [];
const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  workspaceId = randomUUID();
  domainName = `${workspaceId}.example.test`;
  await db.insert(workspaces).values({ id: workspaceId, name: "Synthetic callback", slug: workspaceId, status: "approved" });
  const [domain] = await db.insert(domains).values({ workspaceId, name: domainName }).returning();
  const [binding] = await db.insert(domainProviderBindings).values({ workspaceId, domainId: domain.id, provider: "postmark" }).returning();
  bindingId = binding.id;
  vi.stubEnv("POSTMARK_ENABLED", "true");
  vi.stubEnv("DEPLOYMENT_ENVIRONMENT", "prod");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("POSTMARK_WEBHOOK_BASE_URL", "https://mail.yodev.fr");
  vi.stubEnv("PROVIDER_CREDENTIALS_KMS_KEY_ARN", "arn:aws:kms:eu-west-3:123456789012:key/synthetic");
  dependencies.values.clear();
  dependencies.send.mockReset().mockImplementation(async (command) => { dependencies.values.set(command.input.Name, command.input.Value); return {}; });
  dependencies.queue.mockReset().mockResolvedValue({ local: false });
  webhookExists = false;
  loseCreateResponse = false;
  verificationStatuses.length = 0;
  const response = (body: unknown) => new Response(JSON.stringify(body));
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    const server = { ID: 42, Name: `yodev-mail-prod-${workspaceId}`, DeliveryType: "Live", ApiTokens: ["synthetic-server-token"] };
    const webhook = { ID: 44, Url: `https://mail.yodev.fr/api/providers/postmark/${bindingId}`, Status: "verified" };
    if (path === "/servers" && init?.method === "POST") return response(server);
    if (path === "/servers") return response({ TotalCount: 0, Servers: [] });
    if (path === "/servers/42") return response(server);
    if (path === "/domains") return response({ TotalCount: 1, Domains: [{ ID: 43, Name: domainName }] });
    if (path === "/domains/43") return response({ ID: 43, Name: domainName });
    if ((path === "/webhooks" && init?.method === "POST") || path === "/webhooks/44") {
      const body = JSON.parse(String(init?.body));
      const [account] = await db.select().from(workspaceProviderAccounts).where(and(eq(workspaceProviderAccounts.workspaceId, workspaceId), eq(workspaceProviderAccounts.provider, "postmark")));
      expect(account).toMatchObject({ status: "pending", externalAccountId: "42" });
      for (const RecordType of ["Delivery", "Bounce", "SpamComplaint"]) {
        const reply = await POST(new Request(webhook.Url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-vercel-forwarded-for": "3.134.147.250", authorization: `Basic ${Buffer.from(`${body.HttpAuth.Username}:${body.HttpAuth.Password}`).toString("base64")}` },
          body: JSON.stringify({ RecordType, ServerID: 42, MessageID: "synthetic-verification-message", Type: RecordType === "SpamComplaint" ? "SpamComplaint" : "HardBounce", [RecordType === "Delivery" ? "DeliveredAt" : "BouncedAt"]: "2026-09-07T00:00:00Z", Metadata: { ym_workspace_id: workspaceId } }),
        }), { params: Promise.resolve({ bindingId }) });
        verificationStatuses.push(reply.status);
        expect(reply.status).toBe(200);
      }
      webhookExists = true;
      if (init?.method === "POST" && loseCreateResponse) throw new Error("synthetic response lost after creation");
      return response(webhook);
    }
    if (path === "/webhooks") return response({ Webhooks: webhookExists ? [webhook] : [] });
    throw new Error("unexpected_synthetic_request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
afterAll(async () => { await databasePool!.end(); });

it("authenticates verification callbacks with committed account checkpoints before readiness", async () => {
  await expect(provisionBinding(workspaceId, bindingId)).resolves.toBe("provisioned");
  expect(verificationStatuses).toEqual([200, 200, 200]);
  expect(dependencies.queue.mock.calls.every(([event]) => event.workspaceId === workspaceId)).toBe(true);
  const [account] = await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.workspaceId, workspaceId));
  expect(account.status).toBe("ready");
});

it("recovers a lost create response by updating the same webhook without rotating credentials", async () => {
  loseCreateResponse = true;
  await expect(provisionBinding(workspaceId, bindingId)).rejects.toThrow("provider_provisioning_failed");
  await expect(provisionBinding(workspaceId, bindingId)).resolves.toBe("provisioned");
  expect(fetchMock.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === "/webhooks" && init?.method === "POST")).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([url, init]) => new URL(String(url)).pathname === "/webhooks/44" && init?.method === "PUT")).toHaveLength(1);
  expect(dependencies.send).toHaveBeenCalledTimes(2);
  expect(verificationStatuses).toHaveLength(6);
});

it("rejects malformed authenticated callbacks before queue publication", async () => {
  await provisionBinding(workspaceId, bindingId);
  dependencies.queue.mockClear();
  const password = [...dependencies.values].find(([name]) => name.endsWith("/webhook-password"))?.[1];
  expect(password).toBeDefined();
  const base = { RecordType: "Delivery", ServerID: 42, MessageID: "synthetic-verification-message", DeliveredAt: "2026-09-07T00:00:00Z", Metadata: { ym_workspace_id: workspaceId } };
  for (const payload of [
    { ...base, DeliveredAt: undefined },
    { ...base, DeliveredAt: "2026-02-30T00:00:00Z" },
    { ...base, MessageID: "private@example.net" },
    { ...base, Metadata: { ym_workspace_id: workspaceId, ym_message_id: "not-a-uuid" } },
  ]) {
    const reply = await POST(new Request(`https://mail.yodev.fr/api/providers/postmark/${bindingId}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "3.134.147.250", authorization: `Basic ${Buffer.from(`yodev-mail:${password}`).toString("base64")}` },
      body: JSON.stringify(payload),
    }), { params: Promise.resolve({ bindingId }) });
    expect(reply.status).toBe(400);
    expect(await reply.text()).not.toContain("private");
  }
  expect(dependencies.queue).not.toHaveBeenCalled();
});
