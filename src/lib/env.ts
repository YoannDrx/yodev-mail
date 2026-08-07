import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));

const schema = z.object({
  DATABASE_URL: optionalUrl,
  DATABASE_URL_UNPOOLED: optionalUrl,
  NEXT_PUBLIC_APP_URL: optionalUrl,
  PUBLIC_LINKS_URL: optionalUrl,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),
  API_KEY_PEPPER: z.string().min(16).optional(),
  UNSUBSCRIBE_SIGNING_SECRET: z.string().min(16).optional(),
  WEBHOOK_SIGNING_SECRET: z.string().min(16).optional(),
  ADMIN_USER_IDS: z.string().optional(),
  AWS_REGION: z.string().default("eu-west-3"),
  AWS_ACCOUNT_ID: z.string().optional(),
  AWS_OIDC_AUDIENCE: z
    .string()
    .url()
    .default("https://vercel.com/yoanndrxs-projects"),
  AWS_ROLE_ARN: z.string().optional(),
  AWS_EMAIL_QUEUE_URL: optionalUrl,
  AWS_CAMPAIGN_QUEUE_URL: optionalUrl,
  AWS_CAMPAIGN_QUEUE_ARN: z.string().optional(),
  AWS_IMPORT_BUCKET: z.string().optional(),
  AWS_SCHEDULER_ROLE_ARN: z.string().optional(),
  AWS_SCHEDULER_GROUP: z.string().default("yodev-mail"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_AGENCY: z.string().optional(),
  STRIPE_OVERAGE_STARTER: z.string().optional(),
  STRIPE_OVERAGE_PRO: z.string().optional(),
  STRIPE_OVERAGE_AGENCY: z.string().optional(),
  STRIPE_METER_EVENT_NAME: z.string().default("yodev_mail_emails_sent"),
});

export const env = schema.parse(process.env);

export function isClerkConfigured() {
  return Boolean(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && env.CLERK_SECRET_KEY);
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
