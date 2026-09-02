import { afterEach, describe, expect, it, vi } from "vitest";
import { causalErrorCode, withSafeRouteErrors } from "./safe-route";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("safe API route errors", () => {
  it("finds a nested database error code without inspecting its message", () => {
    expect(causalErrorCode({ cause: { cause: { code: "53000" } } })).toBe("53000");
  });

  it("returns a sanitized 503 and never logs SQL parameters", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withSafeRouteErrors(async () => {
      throw Object.assign(new Error("insert into messages values recipient@example.net"), {
        cause: { code: "53000", params: ["recipient@example.net", "private content"] },
      });
    });

    const response = await handler(new Request("https://api.mail.yodev.fr/v1/emails", { method: "POST" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("x-request-id")).toBe(body.error.requestId);
    expect(body.error.code).toBe("service_unavailable");
    expect(log).toHaveBeenCalledOnce();
    const logged = String(log.mock.calls[0][0]);
    expect(logged).toContain('"code":"database_unavailable"');
    expect(logged).not.toContain("recipient@example.net");
    expect(logged).not.toContain("private content");
  });

  it("returns a sanitized 500 for an unexpected application failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = withSafeRouteErrors(async () => {
      throw new Error("sensitive implementation detail");
    });

    const response = await handler(new Request("https://api.mail.yodev.fr/v1/emails", { method: "POST" }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "internal_error" },
    });
  });
});
