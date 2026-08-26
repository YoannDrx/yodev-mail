#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { YodevMailFoundationStack } from "./foundation-stack";
import { YodevMailStack } from "./yodev-mail-stack";

const app = new App();
const region = "eu-west-3";
const account = process.env.CDK_DEFAULT_ACCOUNT;
const vercelTeam = String(app.node.tryGetContext("vercelTeam") ?? "yoanndrxs-projects");
const alertEmail = process.env.YODEV_MAIL_ALERT_EMAIL;
const budgetAlertEmails = (process.env.YODEV_MAIL_BUDGET_ALERT_EMAILS ?? "")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);
const existingVercelOidcProviderArn =
  process.env.YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN ??
  (account
    ? `arn:aws:iam::${account}:oidc-provider/oidc.vercel.com/${vercelTeam}`
    : undefined);
const activeEnvironments = new Set(
  (process.env.YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const malwareProtectionEnabled =
  process.env.YODEV_MAIL_GUARDDUTY_ENABLED === "true";
const postmarkEnabled = process.env.YODEV_MAIL_POSTMARK_ENABLED === "true";
const sesEnabled = process.env.YODEV_MAIL_SES_ENABLED === "true";
const stripeUsageReportingEnabled =
  process.env.YODEV_MAIL_STRIPE_USAGE_REPORTING_ENABLED === "true";

const foundation = new YodevMailFoundationStack(app, "YodevMailFoundation", {
  alertEmail,
  budgetAlertEmails,
  env: { account, region },
  existingVercelOidcProviderArn,
  guardDutyBudgetEmail: "hello@yodev.fr",
  terminationProtection: true,
  vercelTeam,
});

for (const environment of ["dev", "prod"] as const) {
  const stack = new YodevMailStack(
    app,
    `YodevMail${environment === "dev" ? "Dev" : "Prod"}`,
    {
      alertTopic: foundation.alertTopic,
      environment,
      env: { account, region },
      malwareProtectionEnabled,
      postmarkEnabled,
      sesEnabled,
      stripeUsageReportingEnabled,
      terminationProtection: environment === "prod",
      vercelOidcProvider: foundation.vercelOidcProvider,
      vercelTeam,
      standby: !activeEnvironments.has(environment),
    },
  );
  stack.addStackDependency(foundation);
}
