import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";
import { YodevMailFoundationStack } from "./foundation-stack";
import { YodevMailStack } from "./yodev-mail-stack";

let foundation: Template;
let standbyWorkload: Template;
let activeProductionWorkload: Template;

beforeAll(() => {
  const app = new App();
  const env = { account: "123456789012", region: "eu-west-3" };
  const foundationStack = new YodevMailFoundationStack(app, "Foundation", {
    alertEmail: "alerts@example.com",
    env,
    vercelTeam: "yoanndrxs-projects",
  });
  const workloadStack = new YodevMailStack(app, "Workload", {
    alertTopic: foundationStack.alertTopic,
    environment: "dev",
    env,
    standby: true,
    vercelOidcProvider: foundationStack.vercelOidcProvider,
    vercelTeam: "yoanndrxs-projects",
  });
  const productionStack = new YodevMailStack(app, "Production", {
    alertTopic: foundationStack.alertTopic,
    environment: "prod",
    env,
    malwareProtectionEnabled: true,
    standby: false,
    vercelOidcProvider: foundationStack.vercelOidcProvider,
    vercelTeam: "yoanndrxs-projects",
  });
  foundation = Template.fromStack(foundationStack);
  standbyWorkload = Template.fromStack(workloadStack);
  activeProductionWorkload = Template.fromStack(productionStack);
}, 30_000);

describe("Mail by Yodev AWS infrastructure", () => {
  test("uses the verified team-scoped Vercel OIDC claims", () => {
    foundation.hasResourceProperties("Custom::AWSCDKOpenIdConnectProvider", {
      ClientIDList: ["https://vercel.com/yoanndrxs-projects"],
      Url: "https://oidc.vercel.com/yoanndrxs-projects",
    });
    standbyWorkload.hasResourceProperties(
      "AWS::IAM::Role",
      Match.objectLike({
        AssumeRolePolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Condition: {
                StringEquals: {
                  "oidc.vercel.com/yoanndrxs-projects:aud":
                    "https://vercel.com/yoanndrxs-projects",
                  "oidc.vercel.com/yoanndrxs-projects:sub":
                    "owner:yoanndrxs-projects:project:yodev-mail:environment:preview",
                },
              },
            }),
          ]),
        }),
      }),
    );
  });

  test("can reuse an OIDC provider owned by the legacy foundation stack", () => {
    const app = new App();
    const importedFoundation = new YodevMailFoundationStack(
      app,
      "ImportedFoundation",
      {
        env: { account: "123456789012", region: "eu-west-3" },
        existingVercelOidcProviderArn:
          "arn:aws:iam::123456789012:oidc-provider/oidc.vercel.com/yoanndrxs-projects",
        vercelTeam: "yoanndrxs-projects",
      },
    );
    const importedTemplate = Template.fromStack(importedFoundation);

    importedTemplate.resourceCountIs(
      "Custom::AWSCDKOpenIdConnectProvider",
      0,
    );
  });

  test("encrypts every queue and keeps standby resources passive", () => {
    const queues = standbyWorkload.findResources("AWS::SQS::Queue");

    expect(Object.values(queues)).toHaveLength(8);
    for (const queue of Object.values(queues)) {
      expect(queue.Properties.SqsManagedSseEnabled).toBe(true);
    }
    standbyWorkload.resourceCountIs("AWS::CloudWatch::Alarm", 0);
    standbyWorkload.resourceCountIs("AWS::Lambda::EventSourceMapping", 0);
    standbyWorkload.resourceCountIs("AWS::CloudWatch::Dashboard", 1);
    for (const rule of Object.values(
      standbyWorkload.findResources("AWS::Events::Rule"),
    )) {
      expect(rule.Properties.State).toBe("DISABLED");
    }
  });

  test("caps active email delivery without reserving scarce account concurrency", () => {
    activeProductionWorkload.hasResourceProperties(
      "AWS::Lambda::EventSourceMapping",
      {
      BatchSize: 1,
      ScalingConfig: { MaximumConcurrency: 2 },
      },
    );
    for (const fn of Object.values(
      activeProductionWorkload.findResources("AWS::Lambda::Function"),
    )) {
      expect(fn.Properties.ReservedConcurrentExecutions).toBeUndefined();
    }
  });

  test("adds explicit attachment and ambiguous-outcome alarms in production", () => {
    activeProductionWorkload.resourceCountIs("AWS::CloudWatch::Alarm", 14);
    activeProductionWorkload.resourceCountIs(
      "AWS::Lambda::EventSourceMapping",
      4,
    );
  });

  test("protects 24-hour attachment storage with KMS and GuardDuty", () => {
    activeProductionWorkload.resourceCountIs("AWS::GuardDuty::MalwareProtectionPlan", 1);
    activeProductionWorkload.hasResourceProperties("AWS::S3::Bucket", Match.objectLike({
      BucketEncryption: Match.objectLike({ ServerSideEncryptionConfiguration: Match.anyValue() }),
      LifecycleConfiguration: Match.objectLike({ Rules: Match.arrayWith([Match.objectLike({ ExpirationInDays: 1 })]) }),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    }));
  });

  test("transforms SES events before enqueueing them", () => {
    activeProductionWorkload.hasResourceProperties("AWS::Events::Rule", Match.objectLike({
      EventPattern: Match.objectLike({ source: ["aws.ses"] }),
      Targets: Match.arrayWith([Match.objectLike({ InputTransformer: Match.anyValue() })]),
    }));
  });

  test("creates cent-level cost alerts and a single shared operations topic", () => {
    foundation.resourceCountIs("AWS::Budgets::Budget", 1);
    foundation.resourceCountIs("AWS::SNS::Topic", 1);
    foundation.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetName: "yodev-mail-account-zero-cost",
        BudgetLimit: { Amount: 1, Unit: "USD" },
        CostTypes: Match.objectLike({
          IncludeCredit: false,
          IncludeRefund: false,
        }),
      }),
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: Match.objectLike({
            Threshold: 0.01,
            ThresholdType: "ABSOLUTE_VALUE",
          }),
        }),
      ]),
    });
  });
});
