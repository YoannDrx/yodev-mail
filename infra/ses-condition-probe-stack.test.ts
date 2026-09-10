import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { expect, test } from "vitest";
import { SES_CONDITION_VARIANTS, YodevMailSesConditionProbeStack } from "./ses-condition-probe-stack";
import { SES_PROBE_OPERATOR_ARN } from "./ses-probe-stack";
import { TEST_ACCOUNT_ID, TEST_REGION } from "./test-account-stack";

test("condition diagnostics cannot run in the production account", () => {
  expect(() => new YodevMailSesConditionProbeStack(new App(), "Diagnostic", { env: { account: "274319534967", region: TEST_REGION } })).toThrow();
});

test("diagnostic roles only permit simulator sends on two exact synthetic resources", () => {
  const app = new App();
  const stack = new YodevMailSesConditionProbeStack(app, "Diagnostic", { env: { account: TEST_ACCOUNT_ID, region: TEST_REGION } });
  const template = Template.fromStack(stack);
  const roles = Object.values(template.findResources("AWS::IAM::Role"));
  expect(Object.keys(template.toJSON().Resources)).toHaveLength(4);
  expect(roles).toHaveLength(SES_CONDITION_VARIANTS.length);
  expect(stack.terminationProtection).toBe(true);
  for (const role of roles) {
    expect(role.Properties.AssumeRolePolicyDocument.Statement).toEqual([{ Action: "sts:AssumeRole", Effect: "Allow", Principal: { AWS: SES_PROBE_OPERATOR_ARN } }]);
    const statements = role.Properties.Policies[0].PolicyDocument.Statement;
    expect(statements.map((statement: { Resource: string }) => statement.Resource)).toEqual([
      `arn:aws:ses:${TEST_REGION}:${TEST_ACCOUNT_ID}:identity/dev.ses-probe-20260910a.yodev.fr`,
      `arn:aws:ses:${TEST_REGION}:${TEST_ACCOUNT_ID}:configuration-set/ym-dev-ses-probe-20260910a-txn`,
    ]);
    for (const statement of statements) {
      expect(statement.Action).toBe("ses:SendEmail");
      expect(statement.Effect).toBe("Allow");
      expect(statement.Condition["ForAllValues:StringEquals"]).toEqual({ "ses:Recipients": ["success@simulator.amazonses.com"] });
      expect(statement.Condition.Null).toEqual({ "ses:Recipients": "false" });
    }
    const name = role.Properties.RoleName;
    expect(statements[0].Condition.StringEquals?.["aws:ResourceTag/yodev:environment"]).toBe(name.endsWith("ownership") ? "dev" : undefined);
    for (const statement of statements) {
      expect(statement.Condition.StringLike?.["ses:TenantName"]).toBe(name.endsWith("tenant-like") ? "ym-dev-*" : undefined);
      expect(statement.Condition.StringEquals?.["ses:TenantName"]).toBe(name.endsWith("tenant-equals") ? "ym-dev-ses-probe-20260910a" : undefined);
    }
  }
  expect(new AwsSolutionsChecks(app).validateScope(app)).toMatchObject({ success: true, violations: [] });
});
