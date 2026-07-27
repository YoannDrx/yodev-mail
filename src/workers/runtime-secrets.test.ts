import { describe, expect, test } from "vitest";
import { mapRuntimeParameters } from "@/workers/runtime-secrets";

describe("worker runtime parameters", () => {
  test("maps every encrypted parameter without exposing names in logs", () => {
    expect(
      mapRuntimeParameters("/vigiemail-dev/runtime", [
        {
          Name: "/vigiemail-dev/runtime/database-url",
          Value: "postgres://example",
        },
        {
          Name: "/vigiemail-dev/runtime/stripe-secret-key",
          Value: "sk_test_example",
        },
        {
          Name: "/vigiemail-dev/runtime/unsubscribe-signing-secret",
          Value: "unsubscribe-secret",
        },
        {
          Name: "/vigiemail-dev/runtime/webhook-signing-secret",
          Value: "webhook-secret",
        },
      ]),
    ).toEqual({
      DATABASE_URL: "postgres://example",
      STRIPE_SECRET_KEY: "sk_test_example",
      UNSUBSCRIBE_SIGNING_SECRET: "unsubscribe-secret",
      WEBHOOK_SIGNING_SECRET: "webhook-secret",
    });
  });

  test("fails closed when a required parameter is missing", () => {
    expect(() =>
      mapRuntimeParameters("/vigiemail-prod/runtime", []),
    ).toThrow(
      "Required runtime parameter is missing: /vigiemail-prod/runtime/database-url",
    );
  });
});
