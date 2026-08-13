import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const optionalSecret = z.string().min(32).optional().or(z.literal(""));

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
  API_KEY_PEPPER: z.string().min(16).optional(),
  WEBHOOK_SIGNING_SECRET: z.string().min(16).optional(),
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
