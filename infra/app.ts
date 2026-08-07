#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { YodevMailFoundationStack } from "./foundation-stack";
import { YodevMailStack } from "./yodev-mail-stack";

const app = new App();
const region = "eu-west-3";
const account = process.env.CDK_DEFAULT_ACCOUNT;
const vercelTeam = String(app.node.tryGetContext("vercelTeam") ?? "yoanndrxs-projects");
const alertEmail = process.env.YODEV_MAIL_ALERT_EMAIL;
const activeEnvironments = new Set(
  (process.env.YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

const foundation = new YodevMailFoundationStack(app, "YodevMailFoundation", {
  alertEmail,
  env: { account, region },
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
      terminationProtection: environment === "prod",
      vercelOidcProvider: foundation.vercelOidcProvider,
      vercelTeam,
      standby: !activeEnvironments.has(environment),
    },
  );
  stack.addDependency(foundation);
}
