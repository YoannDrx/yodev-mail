import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  consumeWorkspaceRateLimit: vi.fn(),
  isFeatureEnabled: vi.fn(),
  requireDb: vi.fn(),
}));

vi.mock("@/db", () => ({ requireDb: dependencies.requireDb }));
vi.mock("@/features/api/authenticate-api-key", () => ({
  authenticateApiKey: dependencies.authenticateApiKey,
}));
vi.mock("@/features/api/rate-limit", () => ({
  consumeWorkspaceRateLimit: dependencies.consumeWorkspaceRateLimit,
}));
vi.mock("@/lib/env", () => ({ isFeatureEnabled: dependencies.isFeatureEnabled }));

import { POST } from "./route";

// The only query these gates may reach is the idempotency lookup.
function fakeDb(idempotencyRows: unknown[] = []) {
  const limit = vi.fn(async () => idempotencyRows);
  const db = { select: vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })) };
  dependencies.requireDb.mockReturnValue(db);
  return db;
}

function sendRequest(body: unknown, idempotencyKey = "request-1") {
  return new Request("https://api.mail.yodev.fr/v1/emails", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
    method: "POST",
  });
}

describe("POST /v1/emails production gates", () => {
  beforeEach(() => {
    dependencies.authenticateApiKey.mockResolvedValue({
      mode: "test",
      scopes: ["emails:send"],
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    dependencies.consumeWorkspaceRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
    });
    dependencies.isFeatureEnabled.mockImplementation(
      (feature: string) => feature !== "ATTACHMENTS_ENABLED",
    );
    dependencies.consumeWorkspaceRateLimit.mockClear();
    dependencies.requireDb.mockReset();
  });

  it("rejects previously clean attachment IDs while the attachment gate is closed", async () => {
    const db = fakeDb();
    const response = await POST(new Request("https://api.mail.yodev.fr/v1/emails", {
      body: JSON.stringify({
        attachments: [{ id: "22222222-2222-4222-8222-222222222222" }],
        category: "receipt",
        content: { templateId: "33333333-3333-4333-8333-333333333333" },
        from: { email: "sender@example.com" },
        to: { email: "recipient@example.net" },
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "attachment-gate-test",
      },
      method: "POST",
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "attachments_unavailable",
        message: "Les pièces jointes sont temporairement désactivées.",
      },
    });
    // Only the idempotency lookup ran: no workspace, domain or quota query.
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it("refuses a display name that would add a second recipient with 422", async () => {
    const db = fakeDb();
    for (const name of ["x@other.test, Bob", 'Bob" <evil@other.test>', "a;b", "back\\slash"]) {
      const response = await POST(sendRequest({
        category: "receipt",
        content: { templateId: "33333333-3333-4333-8333-333333333333" },
        from: { email: "sender@example.com" },
        to: { email: "recipient@example.net", name },
      }));
      expect(response.status).toBe(422);
      const body = await response.json();
      expect(body.error.code).toBe("invalid_request");
      expect(body.error.details.fieldErrors).toHaveProperty("to");
    }
    expect(db.select).toHaveBeenCalledTimes(4);
  });

  it("consumes the rate limit for a new idempotency key", async () => {
    fakeDb([]);
    dependencies.consumeWorkspaceRateLimit.mockResolvedValueOnce({ allowed: false, limit: 10, remaining: 0, resetAt: new Date(Date.now() + 30_000) });
    const response = await POST(sendRequest({}, "new-key"));
    expect(response.status).toBe(429);
    expect(dependencies.consumeWorkspaceRateLimit).toHaveBeenCalledTimes(1);
  });

  it("does not consume the rate limit when an existing idempotency key is retried", async () => {
    fakeDb([{ requestHash: "different", response: { ids: ["44444444-4444-4444-8444-444444444444"] } }]);
    dependencies.consumeWorkspaceRateLimit.mockResolvedValue({ allowed: false, limit: 10, remaining: 0, resetAt: new Date(Date.now() + 30_000) });
    const response = await POST(sendRequest({
      category: "receipt",
      content: { templateId: "33333333-3333-4333-8333-333333333333" },
      from: { email: "sender@example.com" },
      to: { email: "recipient@example.net" },
    }, "used-key"));
    // The existing key can only replay or conflict: it never creates a message.
    expect(response.status).toBe(409);
    expect(dependencies.consumeWorkspaceRateLimit).not.toHaveBeenCalled();
  });
});
