#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { VigieMailStack } from "./vigiemail-stack";
const app = new App();
for (const environment of ["dev", "prod"] as const) new VigieMailStack(app, `VigieMail${environment === "dev" ? "Dev" : "Prod"}`, { environment, env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "eu-west-3" } });
