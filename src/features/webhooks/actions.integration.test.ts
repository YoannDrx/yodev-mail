import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  context: undefined as undefined | { workspace: { id: string }; userId: string; role: string },
  deliveryEnabled: false,
  postWebhookSafely: vi.fn(),
  validateWebhookUrl: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/current-workspace", () => ({
  currentWorkspace: vi.fn(async (options: { admin?: boolean } = {}) => {
    if (!dependencies.context) throw new Error("Authentication is required.");
    if (options.admin && !["owner", "admin"].includes(dependencies.context.role)) {
      throw new Error("Workspace administrator role required.");
    }
    return dependencies.context;
  }),
}));
vi.mock("@/lib/env", () => ({
  env: { WEBHOOK_SIGNING_SECRET: "integration-webhook-key-material-0001" },
  isFeatureEnabled: (feature: string) => feature === "CUSTOMER_WEBHOOKS_ENABLED" && dependencies.deliveryEnabled,
}));
vi.mock("@/features/webhooks/validate-url", () => ({ validateWebhookUrl: dependencies.validateWebhookUrl }));
vi.mock("@/features/webhooks/safe-http", () => ({ postWebhookSafely: dependencies.postWebhookSafely }));

import { databasePool, requireDb } from "@/db/runtime";
import { auditEvents, domains, emailEvents, messages, transactionalProfiles, webhookDeliveries, webhookEndpoints, workspaces } from "@/db/schema";
import {
  createWebhookFormAction,
  deleteWebhookAction,
  rotateWebhookSecretAction,
  sendWebhookTestAction,
  toggleWebhookAction,
} from "@/features/webhooks/actions";
import { initialActionState } from "@/lib/action-state";
import { decryptSecret } from "@/lib/crypto";

const db = requireDb();
const pool = databasePool!;
const keyMaterial = "integration-webhook-key-material-0001";

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  const names = result.rows.map(({ tablename }) => tablename).filter((name) => /^[a-z0-9_]+$/.test(name)).map((name) => `"${name}"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function workspace() {
  const id = randomUUID();
  await db.insert(workspaces).values({ id, name: "Webhooks", slug: `webhooks-${id.slice(0, 8)}` });
  return id;
}

function form(entries: Array<[string, string]>) {
  const data = new FormData();
  for (const [key, value] of entries) data.append(key, value);
  return data;
}

async function createEndpoint(url = "https://hooks.example.com/yodev") {
  const state = await createWebhookFormAction(initialActionState(), form([["url", url], ["eventTypes", "email.delivered"], ["eventTypes", "email.hard_bounced"]]));
  expect(state.ok).toBe(true);
  const [endpoint] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId, dependencies.context!.workspace.id));
  return { endpoint, secret: state.data!.secret };
}

describe("customer webhook console actions", () => {
  beforeEach(async () => {
    await cleanDatabase();
    dependencies.context = { workspace: { id: await workspace() }, userId: "user-owner", role: "owner" };
    dependencies.deliveryEnabled = false;
    dependencies.validateWebhookUrl.mockReset().mockImplementation(async (value: string) => new URL(value).toString());
    dependencies.postWebhookSafely.mockReset().mockResolvedValue(204);
  });
  afterAll(async () => {
    await cleanDatabase();
    await pool.end();
  });

  it("checks the role before resolving the URL and creates nothing for a member", async () => {
    dependencies.context = { ...dependencies.context!, role: "member" };
    const state = await createWebhookFormAction(initialActionState(), form([["url", "https://hooks.example.com/x"], ["eventTypes", "email.delivered"]]));
    expect(state).toMatchObject({ ok: false, message: expect.stringContaining("administrateurs") });
    expect(state.values.url).toBe("https://hooks.example.com/x");
    expect(dependencies.validateWebhookUrl).not.toHaveBeenCalled();
    expect(await db.select().from(webhookEndpoints)).toHaveLength(0);
  });

  it("returns field errors and keeps the typed values", async () => {
    const state = await createWebhookFormAction(initialActionState(), form([["url", "not a url"]]));
    expect(state.ok).toBe(false);
    expect(state.fieldErrors.url?.[0]).toMatch(/URL HTTPS/);
    expect(state.fieldErrors.eventTypes?.[0]).toMatch(/au moins un événement/);
    expect(state.values).toEqual({ url: "not a url", eventTypes: "" });
    dependencies.validateWebhookUrl.mockRejectedValueOnce(new Error("private"));
    const refused = await createWebhookFormAction(initialActionState(), form([["url", "https://10.0.0.1/x"], ["eventTypes", "email.sent"]]));
    expect(refused.fieldErrors.url?.[0]).toMatch(/adresses publiques/);
    expect(refused.values).toEqual({ url: "https://10.0.0.1/x", eventTypes: "email.sent" });
  });

  it("stores a versioned encrypted secret and shows it once", async () => {
    const { endpoint, secret } = await createEndpoint();
    expect(secret).toMatch(/^whsec_ym_/);
    expect(endpoint.signingSecretEncrypted.startsWith("v2.")).toBe(true);
    expect(endpoint.signingSecretEncrypted).not.toContain(secret);
    expect(decryptSecret(endpoint.signingSecretEncrypted, keyMaterial)).toBe(secret);
    expect(endpoint.eventTypes).toEqual(["email.delivered", "email.hard_bounced"]);
  });

  it("rotates the secret, and only within the caller's workspace", async () => {
    const { endpoint, secret } = await createEndpoint();
    const rotated = await rotateWebhookSecretAction(initialActionState(), form([["endpointId", endpoint.id]]));
    expect(rotated.ok).toBe(true);
    expect(rotated.data!.secret).not.toBe(secret);
    const [stored] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id));
    expect(decryptSecret(stored.signingSecretEncrypted, keyMaterial)).toBe(rotated.data!.secret);

    dependencies.context = { workspace: { id: await workspace() }, userId: "intruder", role: "owner" };
    expect(await rotateWebhookSecretAction(initialActionState(), form([["endpointId", endpoint.id]]))).toMatchObject({ ok: false });
    expect(await deleteWebhookAction(initialActionState(), form([["endpointId", endpoint.id]]))).toMatchObject({ ok: false });
    expect(await toggleWebhookAction(initialActionState(), form([["endpointId", endpoint.id]]))).toMatchObject({ ok: false });
    const [untouched] = await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id));
    expect(untouched).toMatchObject({ enabled: true, signingSecretEncrypted: stored.signingSecretEncrypted });
  });

  it("disables with pending deliveries abandoned, then deletes", async () => {
    const { endpoint } = await createEndpoint();
    const workspaceId = dependencies.context!.workspace.id;
    const domainId = randomUUID();
    const profileId = randomUUID();
    const messageId = randomUUID();
    await db.insert(domains).values({ id: domainId, workspaceId, name: `${domainId}.example.com` });
    await db.insert(transactionalProfiles).values({ id: profileId, workspaceId, key: "receipt", name: "Receipt", triggerDescription: "Synthetic", recipientRelationship: "Synthetic", contentExample: "Synthetic" });
    await db.insert(messages).values({ id: messageId, workspaceId, domainId, transactionalProfileId: profileId, stream: "transactional", sendMode: "live", status: "delivered", fromEmail: "sender@example.com", toEmail: "recipient@example.net", subject: "Synthetic", html: "<p>x</p>", plainText: "x" });
    const [event] = await db.insert(emailEvents).values({ workspaceId, messageId, provider: "postmark", externalEventId: `test:${randomUUID()}`, type: "email.delivered", occurredAt: new Date(), payload: {} }).returning();
    await db.insert(webhookDeliveries).values({ workspaceId, endpointId: endpoint.id, eventId: event.id, nextAttemptAt: new Date() });
    expect(await toggleWebhookAction(initialActionState(), form([["endpointId", endpoint.id]]))).toMatchObject({ ok: true });
    const [delivery] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpoint.id));
    expect(delivery).toMatchObject({ lastError: "endpoint_disabled", nextAttemptAt: null });
    expect(delivery.terminalAt).not.toBeNull();

    expect(await deleteWebhookAction(initialActionState(), form([["endpointId", endpoint.id]]))).toMatchObject({ ok: true });
    expect(await db.select().from(webhookEndpoints).where(eq(webhookEndpoints.id, endpoint.id))).toHaveLength(0);
    expect(await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.endpointId, endpoint.id))).toHaveLength(0);
    const audit = await db.select({ action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.entityId, endpoint.id)));
    expect(audit.map((row) => row.action).sort()).toEqual(["webhook.created", "webhook.deleted", "webhook.disabled"]);
  });

  it("sends a signed test event only while delivery is open, at most every ten seconds", async () => {
    const { endpoint, secret } = await createEndpoint();
    const closed = await sendWebhookTestAction(initialActionState(), form([["endpointId", endpoint.id]]));
    expect(closed).toMatchObject({ ok: false, message: expect.stringContaining("désactivée") });
    expect(dependencies.postWebhookSafely).not.toHaveBeenCalled();

    dependencies.deliveryEnabled = true;
    const sent = await sendWebhookTestAction(initialActionState(), form([["endpointId", endpoint.id]]));
    expect(sent).toMatchObject({ ok: true, data: { statusCode: 204 } });
    const [{ url, body, headers }] = dependencies.postWebhookSafely.mock.calls[0];
    expect(url).toBe(endpoint.url);
    expect(JSON.parse(body)).toMatchObject({ type: "webhook.test", data: { message_id: null } });
    expect(headers["x-yodev-mail-signature"]).toBe(createHmac("sha256", secret).update(`${headers["x-yodev-mail-timestamp"]}.${body}`).digest("hex"));

    const throttled = await sendWebhookTestAction(initialActionState(), form([["endpointId", endpoint.id]]));
    expect(throttled).toMatchObject({ ok: false, message: expect.stringContaining("Patientez") });
    expect(dependencies.postWebhookSafely).toHaveBeenCalledTimes(1);
  });

  it("reports a non-2xx answer as a failed test", async () => {
    dependencies.deliveryEnabled = true;
    dependencies.postWebhookSafely.mockResolvedValueOnce(500);
    const { endpoint } = await createEndpoint();
    expect(await sendWebhookTestAction(initialActionState(), form([["endpointId", endpoint.id]])))
      .toMatchObject({ ok: false, message: expect.stringContaining("HTTP 500") });
  });
});
