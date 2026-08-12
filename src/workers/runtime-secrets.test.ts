import { describe, expect, test } from "vitest";
import { mapRuntimeParameters } from "@/workers/runtime-secrets";

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
});
