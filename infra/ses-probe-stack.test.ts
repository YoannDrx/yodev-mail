import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, test } from "vitest";
import { sesPermissions } from "./ses-permissions";
import { SES_PROBE_OPERATOR_ARN, YodevMailSesProbeStack } from "./ses-probe-stack";
import { TEST_ACCOUNT_ID, TEST_REGION } from "./test-account-stack";

describe("private SES probe", () => {
  test("refuses the production account", () => {
    expect(() => new YodevMailSesProbeStack(new App(), "Probe", { env: { account: "274319534967", region: TEST_REGION } })).toThrow();
  });
  test("has exactly four private roles with the shared SES-only candidate policies", () => {
    const app = new App();
    const stack = new YodevMailSesProbeStack(app, "Probe", { env: { account: TEST_ACCOUNT_ID, region: TEST_REGION } });
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources;
    expect(Object.keys(resources)).toHaveLength(4);
    template.resourceCountIs("AWS::IAM::Role", 4);
    expect(stack.terminationProtection).toBe(true);
    for (const environment of ["dev", "prod"] as const) {
      for (const kind of ["sender", "provisioner"] as const) {
        template.hasResourceProperties("AWS::IAM::Role", {
          RoleName: `yodev-mail-test-ses-${environment}-${kind}`,
          MaxSessionDuration: 3600,
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [{ Action: "sts:AssumeRole", Effect: "Allow", Principal: { AWS: SES_PROBE_OPERATOR_ARN } }],
          },
          Policies: [{ PolicyName: "CandidateSes", PolicyDocument: {
            Version: "2012-10-17",
            Statement: sesPermissions(TEST_ACCOUNT_ID, TEST_REGION, environment)[kind].map(policy => policy.toStatementJson()),
          } }],
        });
      }
    }
    expect(new AwsSolutionsChecks(app).validateScope(app)).toMatchObject({ success: true, violations: [] });
  });
});
