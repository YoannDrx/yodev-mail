import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { AwsSolutionsChecks } from "cdk-nag";
import { describe, expect, test } from "vitest";
import { YodevMailSesTransportProbeStack } from "./ses-transport-probe-stack";
import { TEST_ACCOUNT_ID, TEST_REGION } from "./test-account-stack";

describe("isolated SES event transport", () => {
  test.each(["274319534967", undefined])("refuses non-test accounts: %s", account => {
    expect(() => new YodevMailSesTransportProbeStack(new App(), "Probe", { env: { account, region: TEST_REGION } })).toThrow();
  });
  test.each([false, true])("only opts into dedicated test delivery events: %s", enabled => {
    const app = new App();
    const stack = new YodevMailSesTransportProbeStack(app, "Probe", { env: { account: TEST_ACCOUNT_ID, region: TEST_REGION }, enabled });
    const t = Template.fromStack(stack);
    t.resourceCountIs("AWS::SQS::Queue", 4);
    t.resourceCountIs("AWS::KMS::Key", 1);
    t.resourceCountIs("AWS::Lambda::Function", 0);
    t.resourceCountIs("AWS::SES::ConfigurationSet", 0);
    t.resourceCountIs("AWS::SES::EmailIdentity", 0);
    expect(stack.terminationProtection).toBe(true);
    const rules = Object.values(t.findResources("AWS::Events::Rule"));
    expect(rules).toHaveLength(2);
    for (const r of rules) {
      expect(r.Properties.State).toBe(enabled ? "ENABLED" : "DISABLED");
      expect(r.Properties.EventPattern).toMatchObject({ source: ["aws.ses"], account: [TEST_ACCOUNT_ID], region: [TEST_REGION] });
      const env = r.Properties.EventPattern.detail.mail.tags.ym_environment[0];
      expect(r.Properties.EventPattern.detail.mail.tags["ses:configuration-set"]).toEqual([`ym-${env}-ses-probe-20260910a-txn`]);
      const target = r.Properties.Targets[0];
      expect(target.DeadLetterConfig).toBeUndefined();
      expect(target.Input).toBeUndefined();
      const paths = Object.values(target.InputTransformer.InputPathsMap);
      expect(paths).toHaveLength(8);
      expect(paths).toContain("$.detail.mail.tags.ym_workspace_id[0]");
      expect(paths).not.toContain("$.detail.mail");
      expect(JSON.stringify(target.InputTransformer)).not.toMatch(/recipients|sourceAddress|headers|subject|diagnosticCode/);
    }
    const destinations = Object.values(t.findResources("AWS::SES::ConfigurationSetEventDestination"));
    expect(destinations).toHaveLength(2);
    for (const d of destinations) expect(d.Properties.EventDestination).toMatchObject({ Enabled: enabled, MatchingEventTypes: ["delivery"] });
    for (const q of Object.values(t.findResources("AWS::SQS::Queue"))) {
      expect(q.Properties.KmsMasterKeyId).toBeDefined();
      expect(q.DeletionPolicy).toBe("Retain");
    }
    const grants = Object.values(t.findResources("AWS::SQS::QueuePolicy")).flatMap(p => p.Properties.PolicyDocument.Statement).filter(s => s.Effect === "Allow");
    expect(grants).toHaveLength(2);
    for (const s of grants) {
      expect(s.Action).toBe("sqs:SendMessage");
      expect(s.Principal).toEqual({ Service: "events.amazonaws.com" });
      expect(s.Condition.StringEquals["aws:SourceAccount"]).toBe(TEST_ACCOUNT_ID);
      expect(s.Condition.ArnEquals["aws:SourceArn"]).toMatch(/:rule\/yodev-mail-test-ses-transport-(dev|prod)$/);
    }
    expect(new AwsSolutionsChecks(app).validateScope(app)).toMatchObject({ success: true, violations: [] });
  // CDK and compliance validation can exceed 5 s beside cold worker bundles.
  }, 30_000);
});
