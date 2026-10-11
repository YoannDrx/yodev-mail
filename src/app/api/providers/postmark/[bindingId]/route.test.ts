import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  requireDb: vi.fn(),
  getSecureParameter: vi.fn(),
}));

vi.mock("@/db", () => ({ requireDb: dependencies.requireDb }));
vi.mock("@/workers/runtime-secrets", () => ({ getSecureParameter: dependencies.getSecureParameter }));
vi.mock("@/lib/aws", () => ({ enqueueProviderEvent: vi.fn() }));
vi.mock("@/features/providers/ingest-event", () => ({ ingestProviderEvent: vi.fn() }));

import { POST } from "./route";

function post(bindingId: string) {
  return POST(new Request(`https://mail.yodev.fr/api/providers/postmark/${encodeURIComponent(bindingId)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }), { params: Promise.resolve({ bindingId }) });
}

describe("POST /api/providers/postmark/[bindingId]", () => {
  beforeEach(() => {
    dependencies.requireDb.mockReset();
    vi.stubEnv("VERCEL_ENV", "preview");
  });

  it.each(["not-a-uuid", "1", "00000000-0000-4000-8000-00000000000g", "' or 1=1 --", "a".repeat(400)])(
    "answers 404 for a malformed binding identifier without querying the database: %s",
    async (bindingId) => {
      const response = await post(bindingId);
      expect(response.status).toBe(404);
      expect(dependencies.requireDb).not.toHaveBeenCalled();
    },
  );

  it("still looks up a well-formed identifier and refuses an unknown binding", async () => {
    const limit = vi.fn(async () => []);
    dependencies.requireDb.mockReturnValue({ select: () => ({ from: () => ({ where: () => ({ limit }) }) }) });
    const response = await post("00000000-0000-4000-8000-000000000001");
    expect(response.status).toBe(403);
    expect(limit).toHaveBeenCalledTimes(1);
  });
});
