import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ secret: vi.fn(), send: vi.fn() }));
vi.mock("@/workers/runtime-secrets", () => ({ getSecureParameter: dependencies.secret }));
vi.mock("@/lib/aws", () => ({ awsClients: async () => ({ ssm: { send: dependencies.send } }) }));
import { provisionPostmarkDomain } from "./provision-postmark";

const input = {
  environment: "prod" as const,
  workspaceId: "00000000-0000-4000-8000-000000000001",
  workspaceName: "Same company name",
  bindingId: "00000000-0000-4000-8000-000000000002",
  domain: "example.test",
  checkpoint: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  beforeWebhookCreate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
};
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const server = { ID: 42, Name: `yodev-mail-prod-${input.workspaceId}`, ApiTokens: ["synthetic-server-token"], DeliveryType: "Live" };
const domain = { ID: 43, Name: input.domain, DKIMHost: "test._domainkey.example.test", DKIMTextValue: "synthetic-public-key" };
beforeEach(() => {
  input.checkpoint.mockClear();
  input.beforeWebhookCreate.mockClear();
  vi.stubEnv("POSTMARK_WEBHOOK_BASE_URL", "https://api.mail.yodev.fr");
  vi.stubEnv("PROVIDER_CREDENTIALS_KMS_KEY_ARN", "arn:aws:kms:eu-west-3:123456789012:key/synthetic");
  dependencies.secret.mockReset().mockResolvedValue("synthetic-server-token");
  dependencies.send.mockReset().mockResolvedValue({});
  fetchMock.mockReset().mockImplementation(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/servers" && init?.method === "POST") return reply(server);
    if (path === "/servers") return reply({ Servers: [], TotalCount: 0 });
    if (path === "/servers/42") return reply(server);
    if (path === "/domains") return reply({ Domains: [domain], TotalCount: 1 });
    if (path === "/domains/43") return reply(domain);
    if ((path === "/webhooks" && init?.method === "POST") || path === "/webhooks/44") return reply({ ID: 44, Status: "verified" });
    if (path === "/webhooks") return reply({ Webhooks: [] });
    throw new Error("unexpected_synthetic_request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Postmark provisioning recovery", () => {
  it("never adopts another workspace server with the same company name", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/servers" && init?.method !== "POST") return reply({ TotalCount: 1, Servers: [{ ...server, ID: 99, Name: `Mail by Yodev · ${input.workspaceName} · PROD` }] });
      if (path === "/servers" && init?.method === "POST") return reply(server);
      if (path === "/servers/99") return reply({ ...server, ID: 99 });
      if (path === "/domains") return reply({ Domains: [domain], TotalCount: 1 });
      if (path === "/domains/43") return reply(domain);
      if (path === "/webhooks" && init?.method === "POST") return reply({ ID: 44, Status: "verified" });
      if (path === "/webhooks") return reply({ Webhooks: [] });
      throw new Error("unexpected_synthetic_request");
    });
    const result = await provisionPostmarkDomain(input);
    expect(result.externalAccountId).toBe("42");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/servers/99"))).toBe(false);
  });

  it("does not create a duplicate webhook after a failed listing", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path === "/servers/42") return reply(server);
      if (path === "/domains") return reply({ Domains: [domain], TotalCount: 1 });
      if (path === "/domains/43") return reply(domain);
      if (path === "/webhooks" && init?.method === "POST") return reply({ ID: 44 });
      if (path === "/webhooks") return reply({ Message: "private provider diagnostic" }, 503);
      throw new Error("unexpected_synthetic_request");
    });
    await expect(provisionPostmarkDomain({ ...input, existingAccount: { externalAccountId: "42", credentialParameterName: "/synthetic/server-token" } })).rejects.toThrow();
    expect(fetchMock.mock.calls.some(([url, init]) => new URL(String(url)).pathname === "/webhooks" && init?.method === "POST")).toBe(false);
  });

  it("checkpoints creation intent, server identity and credentials before webhook verification", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === "/servers" && init?.method === "POST") expect(input.checkpoint).toHaveBeenCalledWith({});
      if (new URL(String(url)).pathname === "/webhooks" && init?.method === "POST") {
        expect(input.checkpoint).toHaveBeenLastCalledWith({ externalAccountId: "42", credentialParameterName: `/yodev-mail-prod/providers/postmark/workspaces/${input.workspaceId}/server-token` });
        expect(input.beforeWebhookCreate).toHaveBeenCalledOnce();
        expect(JSON.parse(String(init.body)).Verify).toBe(true);
      }
      return original(url, init);
    });
    await provisionPostmarkDomain(input);
    expect(input.checkpoint).toHaveBeenNthCalledWith(2, { externalAccountId: "42" });
    expect(dependencies.send.mock.calls.every(([command]) => command.input.Overwrite === false && command.input.Type === "SecureString" && command.input.KeyId)).toBe(true);
  });

  it.each(["servers", "domains"] as const)("paginates %s instead of duplicating a resource past the first page", async (resource) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === `/${resource}` && init?.method !== "POST") {
        const offset = Number(parsed.searchParams.get("offset"));
        const key = resource === "servers" ? "Servers" : "Domains";
        return reply({ TotalCount: 501, [key]: offset === 0
          ? Array.from({ length: 500 }, (_, n) => ({ ID: n + 1000, Name: `unrelated-${n}.test` }))
          : [resource === "servers" ? server : domain] });
      }
      return original(url, init);
    });
    await provisionPostmarkDomain(input);
    expect(fetchMock.mock.calls.some(([url, init]) => new URL(String(url)).pathname === `/${resource}` && init?.method === "POST")).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`/${resource}?count=500&offset=500`))).toBe(true);
  });

  it("refuses ambiguous stable server identities", async () => {
    fetchMock.mockResolvedValue(reply({ TotalCount: 2, Servers: [server, { ...server, ID: 99 }] }));
    await expect(provisionPostmarkDomain(input)).rejects.toThrow("identity_ambiguous");
    expect(dependencies.send).not.toHaveBeenCalled();
    expect(input.checkpoint).not.toHaveBeenCalled();
  });

  it.each([{ TotalCount: 1 }, { TotalCount: 2, Servers: [] }])("rejects an incomplete list before creating anything", async (body) => {
    fetchMock.mockResolvedValue(reply(body));
    await expect(provisionPostmarkDomain(input)).rejects.toThrow("list_invalid");
    expect(input.checkpoint).not.toHaveBeenCalled();
  });

  it("reuses both encrypted credentials after a partial failure instead of overwriting them", async () => {
    dependencies.send.mockRejectedValue(Object.assign(new Error("synthetic conflict"), { name: "ParameterAlreadyExists" }));
    dependencies.secret.mockImplementation(async (name) => String(name).endsWith("webhook-password") ? "synthetic-original-password" : "synthetic-server-token");
    await provisionPostmarkDomain({ ...input, existingAccount: { externalAccountId: "42", credentialParameterName: null } });
    const [, init] = fetchMock.mock.calls.find(([url, init]) => new URL(String(url)).pathname === "/webhooks" && init?.method === "POST")!;
    expect(JSON.parse(String(init?.body)).HttpAuth.Password).toBe("synthetic-original-password");
    expect(dependencies.send.mock.calls.every(([command]) => command.input.Overwrite === false)).toBe(true);
  });

  it("does not replace a stored token belonging to a different server", async () => {
    dependencies.send.mockRejectedValue(Object.assign(new Error("synthetic conflict"), { name: "ParameterAlreadyExists" }));
    dependencies.secret.mockResolvedValue("synthetic-other-server-token");
    await expect(provisionPostmarkDomain(input)).rejects.toThrow("credential_identity_conflict");
    expect(fetchMock.mock.calls.some(([url]) => new URL(String(url)).pathname === "/webhooks")).toBe(false);
  });

  it("keeps uncertain server creation pending for reconciliation if no stable match exists", async () => {
    await expect(provisionPostmarkDomain({ ...input, existingAccount: { externalAccountId: null, credentialParameterName: null } })).rejects.toThrow("server_creation_requires_reconciliation");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("reconciles an existing webhook in place with no content or tracking", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname === "/webhooks") return reply({ Webhooks: [{ ID: 44, Url: `https://api.mail.yodev.fr/api/providers/postmark/${input.bindingId}`, Status: "unverified" }] });
      return original(url, init);
    });
    await provisionPostmarkDomain({ ...input, webhookCreationAttempted: true });
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/webhooks/44"))!;
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toMatchObject({ Verify: true, HttpHeaders: [], Triggers: {
      Open: { Enabled: false }, Click: { Enabled: false }, Delivery: { Enabled: true },
      Bounce: { Enabled: true, IncludeContent: false }, SpamComplaint: { Enabled: true, IncludeContent: false }, SubscriptionChange: { Enabled: false },
    } });
    expect(input.beforeWebhookCreate).not.toHaveBeenCalled();
  });

  it("does not repeat uncertain webhook creation when reconciliation finds no webhook", async () => {
    await expect(provisionPostmarkDomain({ ...input, webhookCreationAttempted: true })).rejects.toThrow("webhook_creation_requires_reconciliation");
    expect(fetchMock.mock.calls.some(([url, init]) => new URL(String(url)).pathname === "/webhooks" && init?.method === "POST")).toBe(false);
  });

  it.each(["unverified", undefined])("does not declare a webhook ready with status %s", async (Status) => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => new URL(String(url)).pathname === "/webhooks" && init?.method === "POST" ? reply({ ID: 44, Status }) : original(url, init));
    await expect(provisionPostmarkDomain(input)).rejects.toThrow("webhook_verification_required");
  });

  it("does not follow a redirect while holding a provider token", async () => {
    await provisionPostmarkDomain(input);
    expect(fetchMock.mock.calls.every(([, init]) => init?.redirect === "error")).toBe(true);
  });

  it("stops all later requests after the shared deadline is aborted", async () => {
    const abort = new AbortController();
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url, init) => { const response = await original(url, init); abort.abort(); return response; });
    await expect(provisionPostmarkDomain({ ...input, signal: abort.signal })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
