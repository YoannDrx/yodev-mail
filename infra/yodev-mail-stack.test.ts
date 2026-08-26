import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { beforeAll, describe, expect, test } from "vitest";
import { YodevMailFoundationStack } from "./foundation-stack";
import { YodevMailStack } from "./yodev-mail-stack";

let foundation: Template;
let standbyWorkload: Template;
let activeProductionWorkload: Template;
let sesCertificationWorkload: Template;

beforeAll(() => {
  const app = new App();
  const env = { account: "123456789012", region: "eu-west-3" };
  const foundationStack = new YodevMailFoundationStack(app, "Foundation", {
    alertEmail: "alerts@example.com",
    env,
    guardDutyBudgetEmail: "hello@yodev.fr",
    vercelTeam: "yoanndrxs-projects",
  });
  const workloadStack = new YodevMailStack(app, "Workload", {
    alertTopic: foundationStack.alertTopic,
    environment: "dev",
    env,
    sesEnabled: true,
    standby: true,
    vercelOidcProvider: foundationStack.vercelOidcProvider,
    vercelTeam: "yoanndrxs-projects",
  });
  const productionStack = new YodevMailStack(app, "Production", {
    alertTopic: foundationStack.alertTopic,
    environment: "prod",
    env,
    malwareProtectionEnabled: true,
    postmarkEnabled: false,
    stripeUsageReportingEnabled: true,
    standby: false,
    vercelOidcProvider: foundationStack.vercelOidcProvider,
    vercelTeam: "yoanndrxs-projects",
  });
  const sesCertificationStack = new YodevMailStack(app, "SesCertification", {
    alertTopic: foundationStack.alertTopic,
    environment: "dev",
    env,
    sesEnabled: true,
    standby: false,
    vercelOidcProvider: foundationStack.vercelOidcProvider,
    vercelTeam: "yoanndrxs-projects",
  });
  foundation = Template.fromStack(foundationStack);
  standbyWorkload = Template.fromStack(workloadStack);
  activeProductionWorkload = Template.fromStack(productionStack);
  sesCertificationWorkload = Template.fromStack(sesCertificationStack);
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

  test("limits the Vercel role to ingress operations without attachment decrypt", () => {
    const policies = activeProductionWorkload.findResources("AWS::IAM::Policy");
    const vercelPolicy = Object.values(policies).find((policy) =>
      JSON.stringify(policy.Properties.Roles).includes("VercelRole"),
    );
    expect(vercelPolicy).toBeDefined();
    const statements = vercelPolicy!.Properties.PolicyDocument.Statement as Array<{
      Action: string | string[];
      Resource: unknown;
    }>;
    const actions = statements.flatMap((statement) =>
      Array.isArray(statement.Action) ? statement.Action : [statement.Action],
    );
    expect(actions).toContain("s3:PutObject");
    expect(actions).not.toContain("s3:GetObject");
    const decryptStatements = statements.filter((statement) =>
      (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes("kms:Decrypt"),
    );
    expect(decryptStatements).not.toHaveLength(0);
    for (const statement of decryptStatements) {
      expect(JSON.stringify(statement.Resource)).not.toContain("AttachmentKey");
    }
    const queueStatements = statements.filter((statement) =>
      (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes("sqs:SendMessage"),
    );
    expect(queueStatements).toHaveLength(2);
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

  test("records and validates encrypted account management events", () => {
    foundation.resourceCountIs("AWS::CloudTrail::Trail", 1);
    foundation.hasResourceProperties("AWS::CloudTrail::Trail", {
      EnableLogFileValidation: true,
      IncludeGlobalServiceEvents: true,
      IsLogging: true,
      IsMultiRegionTrail: true,
      TrailName: "yodev-mail-management",
    });
    foundation.hasResourceProperties(
      "AWS::S3::Bucket",
      Match.objectLike({
        BucketEncryption: Match.objectLike({
          ServerSideEncryptionConfiguration: Match.anyValue(),
        }),
        LifecycleConfiguration: Match.objectLike({
          Rules: Match.arrayWith([
            Match.objectLike({ ExpirationInDays: 365 }),
          ]),
        }),
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: "Enabled" },
      }),
    );
    foundation.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern:
        '{ ($.userIdentity.type = "Root") && ($.userIdentity.invokedBy NOT EXISTS) && ($.eventType != "AwsServiceEvent") }',
      MetricTransformations: Match.arrayWith([
        Match.objectLike({
          MetricName: "RootAccountUsage",
          MetricNamespace: "Yodev/Mail",
          MetricValue: "1",
        }),
      ]),
    });
    foundation.hasResourceProperties("AWS::Logs::LogGroup", {
      KmsKeyId: Match.anyValue(),
      LogGroupName: "/aws/cloudtrail/yodev-mail-management",
      RetentionInDays: 365,
    });
    foundation.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "kms:DescribeKey",
              "kms:Encrypt",
              "kms:GenerateDataKey*",
            ]),
            Effect: "Allow",
          }),
        ]),
      }),
    });
    foundation.hasResourceProperties("AWS::CloudWatch::Alarm", {
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      EvaluationPeriods: 1,
      MetricName: "RootAccountUsage",
      Namespace: "Yodev/Mail",
      Threshold: 1,
      TreatMissingData: "notBreaching",
    });
    foundation.hasResourceProperties("AWS::KMS::Key", {
      EnableKeyRotation: true,
      KeyPolicy: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "kms:Decrypt",
              "kms:Describe*",
              "kms:Encrypt",
              "kms:GenerateDataKey*",
              "kms:ReEncrypt*",
            ]),
            Condition: {
              ArnEquals: {
                "kms:EncryptionContext:aws:logs:arn":
                  Match.objectLike({ "Fn::Join": Match.anyValue() }),
              },
            },
            Principal: {
              Service: Match.objectLike({ "Fn::Join": Match.anyValue() }),
            },
          }),
          Match.objectLike({
            Action: Match.arrayWith(["kms:Decrypt", "kms:GenerateDataKey*"]),
            Principal: { Service: "cloudwatch.amazonaws.com" },
          }),
          Match.objectLike({
            Action: Match.arrayWith(["kms:Decrypt", "kms:GenerateDataKey*"]),
            Principal: { Service: "sns.amazonaws.com" },
          }),
        ]),
      }),
    });
    const keyPolicy = JSON.stringify(
      Object.values(foundation.findResources("AWS::KMS::Key"))[0].Properties
        .KeyPolicy,
    );
    expect(keyPolicy).toContain("logs.");
    expect(keyPolicy).toContain("/aws/cloudtrail/yodev-mail-management");
  });

  test("alerts both operations addresses before and at the account budget limit", () => {
    foundation.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetLimit: { Amount: 10, Unit: "USD" },
        BudgetName: "yodev-mail-account-monthly",
        BudgetType: "COST",
        TimeUnit: "MONTHLY",
      }),
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: Match.objectLike({
            NotificationType: "ACTUAL",
            Threshold: 50,
            ThresholdType: "PERCENTAGE",
          }),
          Subscribers: Match.arrayWith([
            { Address: "alerts@example.com", SubscriptionType: "EMAIL" },
            { Address: "hello@yodev.fr", SubscriptionType: "EMAIL" },
          ]),
        }),
        Match.objectLike({
          Notification: Match.objectLike({
            NotificationType: "FORECASTED",
            Threshold: 80,
            ThresholdType: "PERCENTAGE",
          }),
        }),
        Match.objectLike({
          Notification: Match.objectLike({
            NotificationType: "ACTUAL",
            Threshold: 100,
            ThresholdType: "PERCENTAGE",
          }),
        }),
      ]),
    });
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
    for (const mapping of Object.values(activeProductionWorkload.findResources("AWS::Lambda::EventSourceMapping"))) {
      expect(mapping.Properties.ScalingConfig.MaximumConcurrency).toBe(2);
    }
  });

  test("adds explicit attachment and ambiguous-outcome alarms in production", () => {
    expect(Object.keys(activeProductionWorkload.findResources("AWS::CloudWatch::Alarm")).length).toBeGreaterThanOrEqual(50);
    activeProductionWorkload.resourceCountIs(
      "AWS::Lambda::EventSourceMapping",
      4,
    );
  });

  test("reconciles accepted client owner invitations on a disabled-in-standby schedule", () => {
    activeProductionWorkload.hasResourceProperties(
      "AWS::Events::Rule",
      Match.objectLike({
        ScheduleExpression: "rate(5 minutes)",
        State: "ENABLED",
      }),
    );
    activeProductionWorkload.hasResourceProperties(
      "AWS::CloudWatch::Alarm",
      Match.objectLike({
        MetricName: "ClientProvisioningReconciliationFailed",
        Namespace: "Yodev/Mail",
      }),
    );
  });

  test("keeps every SQS visibility timeout at least six times the Lambda timeout", () => {
    const queues = Object.values(activeProductionWorkload.findResources("AWS::SQS::Queue"));
    const workloadQueues = queues.filter((queue) => !String(queue.Properties.QueueName).endsWith("-dlq"));
    expect(workloadQueues).toHaveLength(4);
    for (const queue of workloadQueues) expect(queue.Properties.VisibilityTimeout).toBeGreaterThanOrEqual(360);
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

  test("keeps SES and Postmark disabled before external approval", () => {
    activeProductionWorkload.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            POSTMARK_ENABLED: "false",
            SES_ENABLED: "false",
          }),
        }),
      }),
    );
    standbyWorkload.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({ SES_ENABLED: "false" }),
        }),
      }),
    );
    sesCertificationWorkload.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({ SES_ENABLED: "true" }),
        }),
      }),
    );

    const keyPolicies = Object.values(foundation.findResources("AWS::KMS::Key"))
      .flatMap((key) => key.Properties.KeyPolicy.Statement as Array<{
        Action: string | string[];
        Condition?: Record<string, unknown>;
        Principal?: Record<string, unknown>;
      }>);
    const cloudTrailStatements = keyPolicies.filter((statement) =>
      JSON.stringify(statement.Principal).includes("cloudtrail.amazonaws.com"),
    );
    expect(cloudTrailStatements.map((statement) => statement.Action)).toEqual(
      expect.arrayContaining(["kms:GenerateDataKey*", "kms:DescribeKey"]),
    );
    const cloudTrailPolicy = JSON.stringify(cloudTrailStatements);
    expect(cloudTrailPolicy).toContain("aws:SourceArn");
    expect(cloudTrailPolicy).toContain("yodev-mail-management");
    expect(cloudTrailPolicy).toContain("kms:EncryptionContext:aws:cloudtrail:arn");
    expect(cloudTrailPolicy).toContain(":cloudtrail:*:123456789012:trail/*");
  });

  test("transforms SES events before enqueueing them", () => {
    activeProductionWorkload.hasResourceProperties("AWS::Events::Rule", Match.objectLike({
      EventPattern: Match.objectLike({ source: ["aws.ses"] }),
      Targets: Match.arrayWith([Match.objectLike({ InputTransformer: Match.anyValue() })]),
    }));
  });

  test("opens Stripe usage only on an explicitly active workload", () => {
    activeProductionWorkload.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            STRIPE_USAGE_REPORTING_ENABLED: "true",
          }),
        }),
      }),
    );
    standbyWorkload.hasResourceProperties(
      "AWS::Lambda::Function",
      Match.objectLike({
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            STRIPE_USAGE_REPORTING_ENABLED: "false",
          }),
        }),
      }),
    );
    const productionFunctions = Object.values(
      activeProductionWorkload.findResources("AWS::Lambda::Function"),
    );
    const stripeUsageFunction = productionFunctions.find((fn) =>
      fn.Properties.FunctionName === "yodev-mail-prod-stripeusage",
    );
    expect(stripeUsageFunction).toBeDefined();
    expect(JSON.stringify(stripeUsageFunction!.Properties.Environment)).not.toContain(
      "STRIPE_SECRET_KEY",
    );
    const productionTemplate = JSON.stringify(activeProductionWorkload.toJSON());
    expect(productionTemplate).toContain("runtime/stripe-usage-secret-key");
    expect(productionTemplate).not.toContain("runtime/stripe-secret-key");
  });

  test("creates staged account and GuardDuty cost alerts with one encrypted operations topic", () => {
    foundation.resourceCountIs("AWS::Budgets::Budget", 2);
    foundation.resourceCountIs("AWS::SNS::Topic", 1);
    foundation.hasResourceProperties("AWS::SNS::Topic", {
      KmsMasterKeyId: Match.anyValue(),
      TopicName: "yodev-mail-operations-alerts",
    });
    foundation.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetName: "yodev-mail-account-monthly",
        BudgetLimit: { Amount: 10, Unit: "USD" },
        CostTypes: Match.objectLike({
          IncludeCredit: false,
          IncludeRefund: false,
        }),
      }),
      NotificationsWithSubscribers: Match.arrayWith([
        Match.objectLike({
          Notification: Match.objectLike({
            Threshold: 50,
            ThresholdType: "PERCENTAGE",
          }),
        }),
      ]),
    });
  });
});
