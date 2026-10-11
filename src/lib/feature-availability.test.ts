import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const flags = [
  "ATTACHMENTS_ENABLED",
  "CUSTOMER_WEBHOOKS_ENABLED",
  "LIVE_EMAIL_ACCEPTANCE_ENABLED",
  "RAW_EMAIL_ENABLED",
  "LIVE_CHECKOUT_ENABLED",
  "COMMERCIAL_ONBOARDING_ENABLED",
] as const;

async function load(values: Partial<Record<(typeof flags)[number], string>>) {
  for (const flag of flags) vi.stubEnv(flag, values[flag]);
  vi.resetModules();
  return import("./feature-availability");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getFeatureAvailability", () => {
  it("keeps every gated capability closed by default", async () => {
    const { getFeatureAvailability, trackingPixelsEnabled } = await load({});
    expect(getFeatureAvailability()).toEqual({
      attachments: false,
      customerWebhooks: false,
      liveSending: false,
      rawEmail: false,
      liveCheckout: false,
      commercialOnboarding: false,
    });
    expect(trackingPixelsEnabled).toBe(false);
  });

  it("follows each environment gate independently", async () => {
    const { getFeatureAvailability } = await load({
      ATTACHMENTS_ENABLED: "true",
      CUSTOMER_WEBHOOKS_ENABLED: "false",
      LIVE_EMAIL_ACCEPTANCE_ENABLED: "true",
      RAW_EMAIL_ENABLED: "false",
      LIVE_CHECKOUT_ENABLED: "true",
      COMMERCIAL_ONBOARDING_ENABLED: "false",
    });
    expect(getFeatureAvailability()).toEqual({
      attachments: true,
      customerWebhooks: false,
      liveSending: true,
      rawEmail: false,
      liveCheckout: true,
      commercialOnboarding: false,
    });
  });
});
