import { afterEach, describe, expect, it } from "vitest";
import {
  assertPostmarkServerDeliveryType,
  normalizePostmarkWebhookBaseUrl,
  provisionPostmarkDomain,
} from "./provision-postmark";

const originalWebhookBaseUrl = process.env.POSTMARK_WEBHOOK_BASE_URL;
const originalKmsKeyArn = process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN;

afterEach(() => {
  if (originalWebhookBaseUrl === undefined) delete process.env.POSTMARK_WEBHOOK_BASE_URL;
  else process.env.POSTMARK_WEBHOOK_BASE_URL = originalWebhookBaseUrl;
  if (originalKmsKeyArn === undefined) delete process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN;
  else process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN = originalKmsKeyArn;
});

describe("Postmark Server delivery type", () => {
  it("refuses an immutable Sandbox Server in production", () => {
    expect(() => assertPostmarkServerDeliveryType({ ID: 42, DeliveryType: "Sandbox" }, "prod"))
      .toThrow(/immutable/);
  });

  it("accepts only the delivery type expected for the environment", () => {
    expect(() => assertPostmarkServerDeliveryType({ ID: 42, DeliveryType: "Live" }, "prod")).not.toThrow();
    expect(() => assertPostmarkServerDeliveryType({ ID: 43, DeliveryType: "Sandbox" }, "dev")).not.toThrow();
  });
});

describe("Postmark webhook base URL", () => {
  it("normalizes a strict HTTPS origin", () => {
    expect(normalizePostmarkWebhookBaseUrl("https://api.mail.yodev.fr/"))
      .toBe("https://api.mail.yodev.fr");
  });

  it.each([
    undefined,
    "not-a-url",
    "http://api.mail.yodev.fr",
    "https://user:password@api.mail.yodev.fr",
    "https://api.mail.yodev.fr/prefix",
    "https://api.mail.yodev.fr?target=other",
    "https://api.mail.yodev.fr#fragment",
  ])("rejects an unsafe or ambiguous origin: %s", (value) => {
    expect(() => normalizePostmarkWebhookBaseUrl(value)).toThrow(/HTTPS origin|required/);
  });

  it("fails before provider access when the webhook origin is missing", async () => {
    delete process.env.POSTMARK_WEBHOOK_BASE_URL;
    process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN = "arn:aws:kms:eu-west-3:123456789012:key/test";

    await expect(provisionPostmarkDomain({
      environment: "prod",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      workspaceName: "Integration",
      bindingId: "00000000-0000-4000-8000-000000000002",
      domain: "example.com",
    })).rejects.toThrow("POSTMARK_WEBHOOK_BASE_URL");
  });

  it("requires customer-managed KMS encryption before creating credentials", async () => {
    process.env.POSTMARK_WEBHOOK_BASE_URL = "https://api.mail.yodev.fr";
    delete process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN;

    await expect(provisionPostmarkDomain({
      environment: "prod",
      workspaceId: "00000000-0000-4000-8000-000000000001",
      workspaceName: "Integration",
      bindingId: "00000000-0000-4000-8000-000000000002",
      domain: "example.com",
    })).rejects.toThrow("PROVIDER_CREDENTIALS_KMS_KEY_ARN");
  });
});
