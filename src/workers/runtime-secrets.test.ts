import { afterEach, describe, expect, test, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ ssmSend: vi.fn() }));

vi.mock("@/lib/aws", () => ({
  awsClients: vi.fn(async () => ({ ssm: { send: dependencies.ssmSend } })),
}));

import {
  getSecureParameter,
  loadRuntimeSecrets,
  mapRuntimeParameters,
} from "@/workers/runtime-secrets";

afterEach(() => {
  dependencies.ssmSend.mockReset();
  delete process.env.RUNTIME_PARAMETER_PREFIX;
  delete process.env.DATABASE_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.WEBHOOK_SIGNING_SECRET;
});

describe("worker runtime parameters", () => {
  test("maps every encrypted parameter without exposing names in logs", () => {
    expect(
      mapRuntimeParameters("/yodev-mail-dev/runtime", [
        {
          Name: "/yodev-mail-dev/runtime/database-url",
          Value: "postgres://example",
        },
        {
          Name: "/yodev-mail-dev/runtime/stripe-secret-key",
          Value: "sk_test_example",
        },
        {
          Name: "/yodev-mail-dev/runtime/webhook-signing-secret",
          Value: "webhook-secret",
        },
      ]),
    ).toEqual({
      DATABASE_URL: "postgres://example",
      STRIPE_SECRET_KEY: "sk_test_example",
      WEBHOOK_SIGNING_SECRET: "webhook-secret",
    });
  });

  test("fails closed when a required parameter is missing", () => {
    expect(() =>
      mapRuntimeParameters("/yodev-mail-prod/runtime", []),
    ).toThrow(
      "Required runtime parameter is missing: /yodev-mail-prod/runtime/database-url",
    );
  });

  test("maps only the secret explicitly required by a worker", () => {
    expect(
      mapRuntimeParameters(
        "/yodev-mail-prod/runtime",
        [{ Name: "/yodev-mail-prod/runtime/database-url", Value: "postgres://example" }],
        ["DATABASE_URL"],
      ),
    ).toEqual({ DATABASE_URL: "postgres://example" });
  });

  test("loads one encrypted runtime parameter and reuses the environment value", async () => {
    process.env.RUNTIME_PARAMETER_PREFIX = "/integration/runtime";
    dependencies.ssmSend.mockResolvedValue({
      Parameters: [{
        Name: "/integration/runtime/database-url",
        Value: "postgres://integration",
      }],
    });

    await Promise.all([
      loadRuntimeSecrets(["DATABASE_URL"]),
      loadRuntimeSecrets(["DATABASE_URL"]),
    ]);
    await loadRuntimeSecrets(["DATABASE_URL"]);

    expect(process.env.DATABASE_URL).toBe("postgres://integration");
    expect(dependencies.ssmSend).toHaveBeenCalledTimes(1);
  });

  test("fails closed on invalid runtime parameters and permits a later retry", async () => {
    process.env.RUNTIME_PARAMETER_PREFIX = "/integration-invalid/runtime";
    dependencies.ssmSend
      .mockResolvedValueOnce({ InvalidParameters: ["stripe-secret-key"] })
      .mockResolvedValueOnce({
        Parameters: [{
          Name: "/integration-invalid/runtime/stripe-secret-key",
          Value: "stripe-retry-value",
        }],
      });

    await expect(loadRuntimeSecrets(["STRIPE_SECRET_KEY"])).rejects.toThrow("invalid");
    await expect(loadRuntimeSecrets(["STRIPE_SECRET_KEY"])).resolves.toBeUndefined();
    expect(process.env.STRIPE_SECRET_KEY).toBe("stripe-retry-value");
  });

  test("returns immediately when runtime loading is not configured", async () => {
    await expect(loadRuntimeSecrets()).resolves.toBeUndefined();
    expect(dependencies.ssmSend).not.toHaveBeenCalled();
  });

  test("loads and caches a provider parameter without exposing it", async () => {
    const name = "/integration/providers/postmark/test-token";
    dependencies.ssmSend.mockResolvedValue({ Parameters: [{ Name: name, Value: "token-value" }] });

    await expect(getSecureParameter(name)).resolves.toBe("token-value");
    await expect(getSecureParameter(name)).resolves.toBe("token-value");

    expect(dependencies.ssmSend).toHaveBeenCalledTimes(1);
  });

  test("fails closed when a provider parameter has no value", async () => {
    dependencies.ssmSend.mockResolvedValue({ Parameters: [] });
    await expect(getSecureParameter("/integration/providers/missing")).rejects.toThrow(
      "credential is unavailable",
    );
  });
});
