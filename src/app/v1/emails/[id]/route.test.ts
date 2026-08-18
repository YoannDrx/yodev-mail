import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  consumeWorkspaceRateLimit: vi.fn(),
  requireDb: vi.fn(),
}));

vi.mock("@/db", () => ({ requireDb: dependencies.requireDb }));
vi.mock("@/features/api/authenticate-api-key", () => ({
  authenticateApiKey: dependencies.authenticateApiKey,
}));
vi.mock("@/features/api/rate-limit", () => ({
  consumeWorkspaceRateLimit: dependencies.consumeWorkspaceRateLimit,
}));

import { GET } from "./route";

describe("GET /v1/emails/:id", () => {
  beforeEach(() => {
    dependencies.authenticateApiKey.mockResolvedValue({
      mode: "live",
      scopes: ["emails:read"],
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    dependencies.consumeWorkspaceRateLimit.mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      resetAt: new Date(Date.now() + 60_000),
    });
  });

  it("returns not_found without querying Postgres for a malformed UUID", async () => {
    const response = await GET(
      new Request("https://api.mail.yodev.fr/v1/emails/not-a-uuid"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: { code: "not_found" } });
    expect(dependencies.requireDb).not.toHaveBeenCalled();
  });
});
