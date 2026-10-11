import "server-only";

import { isFeatureEnabled } from "@/lib/env";

/**
 * Single source of truth for what the product can actually do right now.
 * Public pages and the console must read availability from here instead of
 * hard-coding promises, so that marketing never advertises a gated feature.
 */
export type FeatureAvailability = {
  /** POST /v1/attachments and attachments on /v1/emails. */
  attachments: boolean;
  /** Signed customer webhook deliveries. */
  customerWebhooks: boolean;
  /** Live (`ym_live_*`) acceptance on /v1/emails; test keys always work. */
  liveSending: boolean;
  /** Raw HTML content (still requires a hybrid policy and a dedicated scope). */
  rawEmail: boolean;
  /** Self-service live Stripe checkout. */
  liveCheckout: boolean;
  /** Admin commercial onboarding of new workspaces. */
  commercialOnboarding: boolean;
};

/** The product never injects open pixels nor rewrites links, whatever the flags. */
export const trackingPixelsEnabled = false as const;

export function getFeatureAvailability(): FeatureAvailability {
  return {
    attachments: isFeatureEnabled("ATTACHMENTS_ENABLED"),
    customerWebhooks: isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED"),
    liveSending: isFeatureEnabled("LIVE_EMAIL_ACCEPTANCE_ENABLED"),
    rawEmail: isFeatureEnabled("RAW_EMAIL_ENABLED"),
    liveCheckout: isFeatureEnabled("LIVE_CHECKOUT_ENABLED"),
    commercialOnboarding: isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED"),
  };
}
