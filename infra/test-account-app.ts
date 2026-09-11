import { App, Validations } from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { assertTestAccount, TEST_ACCOUNT_ID, TEST_REGION, YodevMailTestAuditStack } from "./test-account-stack";
import { YodevMailSesProbeStack } from "./ses-probe-stack";
import { YodevMailSesConditionProbeStack } from "./ses-condition-probe-stack";
import { YodevMailSesTransportProbeStack } from "./ses-transport-probe-stack";

// No .env.local load here: it contains existing production deployment inputs.
// An offline synth is safe; a supplied CDK account/region must match exactly.
assertTestAccount(process.env.CDK_DEFAULT_ACCOUNT ?? TEST_ACCOUNT_ID, process.env.CDK_DEFAULT_REGION ?? TEST_REGION);
const app = new App();
const checks = new AwsSolutionsChecks(app, { verbose: true });
Validations.of(app).addPlugins(checks);
new YodevMailTestAuditStack(app, "YodevMailTestAudit", {
  env: { account: TEST_ACCOUNT_ID, region: TEST_REGION },
});
new YodevMailSesProbeStack(app, "YodevMailSesProbe", {
  env: { account: TEST_ACCOUNT_ID, region: TEST_REGION },
});
if (app.node.tryGetContext("sesTransport") === "true") new YodevMailSesTransportProbeStack(app, "YodevMailSesTransportProbe", {
  env: { account: TEST_ACCOUNT_ID, region: TEST_REGION },
  enabled: app.node.tryGetContext("sesTransportEnabled") === "true",
});
// Explicit opt-in; never included in the normal test foundation deployment.
if (app.node.tryGetContext("sesDiagnostics") === "true") new YodevMailSesConditionProbeStack(app, "YodevMailSesConditionProbe", {
  env: { account: TEST_ACCOUNT_ID, region: TEST_REGION },
});
app.synth();
// CDK versions may not execute v3 plugins during synth; never accept an empty
// plugin report as proof that the rules ran. This explicit check also gates CI.
const compliance = checks.validateScope(app);
console.log(JSON.stringify({ scope: "test-account", compliance }));
if (!compliance.success) throw new Error("Test account compliance checks failed");
