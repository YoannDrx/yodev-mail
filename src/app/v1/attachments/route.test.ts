import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  awsClients: vi.fn(),
  consumeWorkspaceRateLimit: vi.fn(),
  getSignedUrl: vi.fn(),
  insert: vi.fn(),
  isFeatureEnabled: vi.fn(),
  values: vi.fn(),
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: dependencies.getSignedUrl,
}));
vi.mock("@/db", () => ({
  requireDb: () => ({ insert: dependencies.insert }),
}));
vi.mock("@/features/api/authenticate-api-key", () => ({
  authenticateApiKey: dependencies.authenticateApiKey,
}));
vi.mock("@/features/api/rate-limit", () => ({
  consumeWorkspaceRateLimit: dependencies.consumeWorkspaceRateLimit,
}));
vi.mock("@/lib/aws", () => ({ awsClients: dependencies.awsClients }));
vi.mock("@/lib/env", () => ({
  env: { AWS_ATTACHMENTS_BUCKET: "attachments-bucket" },
  isFeatureEnabled: dependencies.isFeatureEnabled,
}));

import { POST } from "./route";

describe("POST /v1/attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.authenticateApiKey.mockResolvedValue({
      mode: "live",
      scopes: ["attachments:write"],
      workspaceId: "11111111-1111-4111-8111-111111111111",
    });
    dependencies.consumeWorkspaceRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetAt: new Date(Date.now() + 60_000),
    });
    dependencies.isFeatureEnabled.mockReturnValue(true);
    dependencies.awsClients.mockResolvedValue({ s3: {} });
    dependencies.getSignedUrl.mockResolvedValue("https://attachments.example/upload");
    dependencies.values.mockResolvedValue(undefined);
    dependencies.insert.mockReturnValue({ values: dependencies.values });
  });

  it("keeps the required SHA-256 checksum in a signed request header", async () => {
    const response = await POST(new Request("https://api.mail.yodev.fr/v1/attachments", {
      body: JSON.stringify({
        contentType: "application/pdf",
        fileName: "receipt.pdf",
        sha256: "a".repeat(64),
        sizeBytes: 1024,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }));

    expect(response.status).toBe(201);
    expect(dependencies.getSignedUrl).toHaveBeenCalledWith(
      {},
      expect.anything(),
      expect.objectContaining({
        expiresIn: 600,
        unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        requiredHeaders: {
          "content-type": "application/pdf",
          "x-amz-checksum-sha256": expect.any(String),
        },
      },
    });
  });
});
