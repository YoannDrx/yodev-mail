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
  });

  it("rejects previously clean attachment IDs while the attachment gate is closed", async () => {
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
    expect(dependencies.requireDb).not.toHaveBeenCalled();
  });
});
