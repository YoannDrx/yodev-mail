import { App, Stack, Validations } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Annotations, Match, Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, test } from "vitest";
import { assertTestAccount, TEST_ACCOUNT_ID, TEST_REGION, YodevMailTestAuditStack } from "./test-account-stack";

describe("dedicated AWS test account", () => {
  test("compliance checker actually rejects an unprotected bucket", () => {
    const app = new App();
    const stack = new Stack(app, "NegativeControl");
    new Bucket(stack, "Unprotected");
    Template.fromStack(stack);
    const report = new AwsSolutionsChecks(app).validateScope(app);
    expect(report.success).toBe(false);
    expect(report.violations.some(finding => finding.ruleName === "AwsSolutions-S10")).toBe(true);
  });
  test("refuses production, missing account and other regions", () => {
    for (const account of [undefined, "274319534967", "123456789012"]) {
      expect(() => assertTestAccount(account, TEST_REGION)).toThrow();
    }
    expect(() => assertTestAccount(TEST_ACCOUNT_ID, "us-east-1")).toThrow();
    expect(() => assertTestAccount(TEST_ACCOUNT_ID, TEST_REGION)).not.toThrow();
  });

  test("retains encrypted management logs without application resources or data events", () => {
    const app = new App();
    const stack = new YodevMailTestAuditStack(app, "Audit", { env: { account: TEST_ACCOUNT_ID, region: TEST_REGION } });
    const checks = new AwsSolutionsChecks(app, { verbose: true });
    Validations.of(app).addPlugins(checks);
    const template = Template.fromStack(stack);
    expect(stack.terminationProtection).toBe(true);
    template.hasResource("AWS::KMS::Key", { DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: Match.objectLike({ EnableKeyRotation: true }) });
    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain",
      Properties: Match.objectLike({
        BucketEncryption: Match.anyValue(), VersioningConfiguration: { Status: "Enabled" },
        PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      }),
    });
    template.hasResourceProperties("AWS::Logs::LogGroup", { KmsKeyId: Match.anyValue(), RetentionInDays: 365 });
    template.hasResourceProperties("AWS::S3::BucketPolicy", {
      PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({
        Effect: "Deny", Principal: { Service: "cloudtrail.amazonaws.com" },
        Condition: { StringNotEquals: { "aws:SourceArn": Match.anyValue() } },
      })]), Version: "2012-10-17" },
    });
    template.hasResourceProperties("AWS::CloudTrail::Trail", {
      IsLogging: true, IsMultiRegionTrail: true, IncludeGlobalServiceEvents: true,
      EnableLogFileValidation: true, KMSKeyId: Match.anyValue(),
      EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: "All" }],
    });
    for (const type of ["AWS::Lambda::Function", "AWS::SQS::Queue", "AWS::IAM::User", "AWS::IAM::AccessKey", "AWS::IAM::OIDCProvider"]) {
      template.resourceCountIs(type, 0);
    }
    Annotations.fromStack(stack).hasNoError("*", Match.anyValue());
    Annotations.fromStack(stack).hasNoWarning("*", Match.anyValue());
    expect(checks.validateScope(app)).toMatchObject({ success: true, violations: [] });
  });
});
