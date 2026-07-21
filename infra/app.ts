#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { VigieMailFoundationStack } from "./foundation-stack";
import { VigieMailStack } from "./vigiemail-stack";

const app = new App();
const region = "eu-west-3";
const account = process.env.CDK_DEFAULT_ACCOUNT;
const vercelTeam = String(app.node.tryGetContext("vercelTeam") ?? "yoanndrxs-projects");
const alertEmail = process.env.VIGIEMAIL_ALERT_EMAIL;

const foundation = new VigieMailFoundationStack(app, "VigieMailFoundation", {
  alertEmail,
  env: { account, region },
  terminationProtection: true,
  vercelTeam,
});

for (const environment of ["dev", "prod"] as const) {
  const stack = new VigieMailStack(
    app,
    `VigieMail${environment === "dev" ? "Dev" : "Prod"}`,
    {
      alertTopic: foundation.alertTopic,
      environment,
      env: { account, region },
      terminationProtection: environment === "prod",
      vercelOidcProvider: foundation.vercelOidcProvider,
      vercelTeam,
    },
  );
  stack.addDependency(foundation);
}
