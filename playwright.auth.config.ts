import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { authTestDatabaseUrl } from "./test/e2e/database";

const databaseUrl = authTestDatabaseUrl();
const baseURL = "http://localhost:3918";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "authenticated.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results/authenticated",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "npm run dev -- --port 3918",
    // Compile the auth handler before timing browser interactions on a cold dev server.
    url: `${baseURL}/api/auth/get-session`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
      NEXT_PUBLIC_APP_URL: baseURL,
      BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
      BETTER_AUTH_TRUSTED_ORIGINS: baseURL,
      BETTER_AUTH_GOOGLE_CLIENT_ID: "local-certification.invalid",
      BETTER_AUTH_GOOGLE_CLIENT_SECRET: "local-only-not-a-google-credential",
      BETTER_AUTH_EMAIL_PASSWORD_ENABLED: "true",
      AUTH_BOOTSTRAP_EMAIL: "unused-bootstrap@example.invalid",
      API_KEY_PEPPER: randomBytes(32).toString("hex"),
      WEBHOOK_SIGNING_SECRET: "",
      AWS_PROFILE: "", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "", AWS_SESSION_TOKEN: "",
      AWS_ROLE_ARN: "", AWS_ACCOUNT_ID: "", AWS_OIDC_AUDIENCE: "", AWS_EC2_METADATA_DISABLED: "true",
      AWS_EMAIL_QUEUE_URL: "", AWS_PROVIDER_EVENTS_QUEUE_URL: "", AWS_PROVIDER_PROVISIONING_QUEUE_URL: "",
      AWS_ATTACHMENTS_BUCKET: "", POSTMARK_SYSTEM_SERVER_TOKEN_PARAMETER: "",
      SES_ENABLED: "false", POSTMARK_ENABLED: "false",
      STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", STRIPE_PRICE_PLATFORM: "", STRIPE_PRICE_USAGE: "",
      STRIPE_TAX_MODE: "unconfigured", COMMERCIAL_ONBOARDING_ENABLED: "false",
      LIVE_CHECKOUT_ENABLED: "false", STRIPE_USAGE_REPORTING_ENABLED: "false",
      ATTACHMENTS_ENABLED: "false", RAW_EMAIL_ENABLED: "false",
      LIVE_EMAIL_ACCEPTANCE_ENABLED: "false", CUSTOMER_WEBHOOKS_ENABLED: "false",
    },
  },
  projects: [{ name: "chromium-auth", use: { ...devices["Desktop Chrome"] } }],
});
