import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const optionalSecret = z.string().min(32).optional().or(z.literal(""));
const optionalSecret16 = z.string().min(16).optional().or(z.literal(""));

const schema = z.object({
  DATABASE_URL: optionalUrl,
  DATABASE_URL_UNPOOLED: optionalUrl,
  NEXT_PUBLIC_APP_URL: optionalUrl,
  BETTER_AUTH_SECRET: optionalSecret,
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
  BETTER_AUTH_GOOGLE_CLIENT_ID: z.string().optional(),
  BETTER_AUTH_GOOGLE_CLIENT_SECRET: z.string().optional(),
  BETTER_AUTH_EMAIL_PASSWORD_ENABLED: z.enum(["true", "false"]).default("false"),
  AUTH_BOOTSTRAP_EMAIL: z.string().email().default("yoann.andrieux@gmail.com"),
  API_KEY_PEPPER: optionalSecret16,
  WEBHOOK_SIGNING_SECRET: optionalSecret16,
  AWS_REGION: z.string().default("eu-west-3"),
  AWS_ACCOUNT_ID: z.string().optional(),
  AWS_OIDC_AUDIENCE: optionalUrl,
  AWS_ROLE_ARN: z.string().optional(),
  AWS_EMAIL_QUEUE_URL: optionalUrl,
  AWS_PROVIDER_EVENTS_QUEUE_URL: optionalUrl,
  AWS_PROVIDER_PROVISIONING_QUEUE_URL: optionalUrl,
  AWS_ATTACHMENTS_BUCKET: z.string().optional(),
  SES_ENABLED: z.enum(["true", "false"]).default("false"),
  POSTMARK_ENABLED: z.enum(["true", "false"]).default("false"),
  POSTMARK_SYSTEM_SERVER_TOKEN_PARAMETER: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PLATFORM: z.string().optional(),
  STRIPE_PRICE_USAGE: z.string().optional(),
  STRIPE_METER_EVENT_NAME: z.string().default("yodev_mail_emails_sent"),
  STRIPE_TAX_MODE: z
    .enum(["unconfigured", "franchise_base", "registered"])
    .default("unconfigured"),
  COMMERCIAL_ONBOARDING_ENABLED: z.enum(["true", "false"]).default("false"),
  LIVE_CHECKOUT_ENABLED: z.enum(["true", "false"]).default("false"),
  STRIPE_USAGE_REPORTING_ENABLED: z.enum(["true", "false"]).default("false"),
  ATTACHMENTS_ENABLED: z.enum(["true", "false"]).default("false"),
  RAW_EMAIL_ENABLED: z.enum(["true", "false"]).default("false"),
  LIVE_EMAIL_ACCEPTANCE_ENABLED: z.enum(["true", "false"]).default("false"),
  CUSTOMER_WEBHOOKS_ENABLED: z.enum(["true", "false"]).default("false"),
});

export const env = schema.parse(process.env);

export function isBetterAuthConfigured() {
  return Boolean(
    env.DATABASE_URL &&
      env.BETTER_AUTH_SECRET &&
      env.BETTER_AUTH_GOOGLE_CLIENT_ID &&
      env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
  );
}

export function isDatabaseConfigured() {
  return Boolean(env.DATABASE_URL);
}

export function isAwsConfigured() {
  return Boolean(env.AWS_EMAIL_QUEUE_URL);
}

export function isStripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function isFeatureEnabled(
  feature:
    | "COMMERCIAL_ONBOARDING_ENABLED"
    | "LIVE_CHECKOUT_ENABLED"
    | "STRIPE_USAGE_REPORTING_ENABLED"
    | "ATTACHMENTS_ENABLED"
    | "RAW_EMAIL_ENABLED"
    | "LIVE_EMAIL_ACCEPTANCE_ENABLED"
    | "CUSTOMER_WEBHOOKS_ENABLED",
) {
  return env[feature] === "true";
}
