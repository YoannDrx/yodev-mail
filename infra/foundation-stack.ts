import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { ReadWriteType, Trail } from "aws-cdk-lib/aws-cloudtrail";
import {
  OpenIdConnectProvider,
  PolicyStatement,
  ServicePrincipal,
  type IOpenIdConnectProvider,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { FilterPattern, LogGroup, MetricFilter, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface YodevMailFoundationStackProps extends StackProps {
  alertEmail?: string;
  existingVercelOidcProviderArn?: string;
  guardDutyBudgetEmail?: string;
  vercelTeam: string;
}

export class YodevMailFoundationStack extends Stack {
  readonly alertTopic: Topic;
  readonly vercelOidcProvider: IOpenIdConnectProvider;

  constructor(scope: Construct, id: string, props: YodevMailFoundationStackProps) {
    super(scope, id, props);

    const issuerUrl = `https://oidc.vercel.com/${props.vercelTeam}`;
    const audience = `https://vercel.com/${props.vercelTeam}`;
    const auditKey = new Key(this, "AuditKey", {
      alias: "yodev-mail-audit",
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const alarmArn = `arn:${this.partition}:cloudwatch:${this.region}:${this.account}:alarm:*`;
    const cloudTrailLogGroupArn = `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/cloudtrail/yodev-mail-management`;
    const operationsTopicArn = `arn:${this.partition}:sns:${this.region}:${this.account}:yodev-mail-operations-alerts`;
    const trailArn = `arn:${this.partition}:cloudtrail:${this.region}:${this.account}:trail/yodev-mail-management`;
    const cloudTrailPrincipal = new ServicePrincipal("cloudtrail.amazonaws.com");
    auditKey.addToResourcePolicy(new PolicyStatement({
      actions: ["kms:GenerateDataKey*"],
      conditions: {
        StringEquals: { "aws:SourceArn": trailArn },
        StringLike: {
          "kms:EncryptionContext:aws:cloudtrail:arn":
            `arn:${this.partition}:cloudtrail:*:${this.account}:trail/*`,
        },
      },
      principals: [cloudTrailPrincipal],
      resources: ["*"],
    }));
    auditKey.addToResourcePolicy(new PolicyStatement({
      actions: ["kms:DescribeKey"],
      conditions: { StringEquals: { "aws:SourceArn": trailArn } },
      principals: [cloudTrailPrincipal],
      resources: ["*"],
    }));
    auditKey.addToResourcePolicy(new PolicyStatement({
      actions: [
        "kms:Decrypt",
        "kms:Describe*",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:ReEncrypt*",
      ],
      conditions: {
        ArnEquals: {
          "kms:EncryptionContext:aws:logs:arn": cloudTrailLogGroupArn,
        },
      },
      principals: [new ServicePrincipal(`logs.${this.region}.${this.urlSuffix}`)],
      resources: ["*"],
    }));
    auditKey.addToResourcePolicy(new PolicyStatement({
      actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
      conditions: {
        ArnLike: { "aws:SourceArn": alarmArn },
        StringEquals: { "aws:SourceAccount": this.account },
      },
      principals: [new ServicePrincipal("cloudwatch.amazonaws.com")],
      resources: ["*"],
    }));
    auditKey.addToResourcePolicy(new PolicyStatement({
      actions: ["kms:Decrypt", "kms:GenerateDataKey*"],
      conditions: {
        StringEquals: {
          "aws:SourceAccount": this.account,
          "kms:EncryptionContext:aws:sns:topicArn": operationsTopicArn,
        },
      },
      principals: [new ServicePrincipal("sns.amazonaws.com")],
      resources: ["*"],
    }));

    this.vercelOidcProvider = props.existingVercelOidcProviderArn
      ? OpenIdConnectProvider.fromOpenIdConnectProviderArn(
          this,
          "VercelOidc",
          props.existingVercelOidcProviderArn,
        )
      : new OpenIdConnectProvider(this, "VercelOidc", {
          url: issuerUrl,
          clientIds: [audience],
        });

    this.alertTopic = new Topic(this, "OperationsAlerts", {
      displayName: "Mail by Yodev operations alerts",
      masterKey: auditKey,
      topicName: "yodev-mail-operations-alerts",
    });

    const trailBucket = new Bucket(this, "CloudTrailLogs", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.KMS,
      encryptionKey: auditKey,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(365) }],
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: true,
    });
    const trailLogGroup = new LogGroup(this, "CloudTrailLogGroup", {
      encryptionKey: auditKey,
      logGroupName: "/aws/cloudtrail/yodev-mail-management",
      removalPolicy: RemovalPolicy.RETAIN,
      retention: RetentionDays.ONE_YEAR,
    });
    new Trail(this, "ManagementTrail", {
      bucket: trailBucket,
      cloudWatchLogGroup: trailLogGroup,
      enableFileValidation: true,
      encryptionKey: auditKey,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
      managementEvents: ReadWriteType.ALL,
      sendToCloudWatchLogs: true,
      trailName: "yodev-mail-management",
    });
    const rootUsage = new MetricFilter(this, "RootAccountUsageMetric", {
      filterPattern: FilterPattern.literal(
        '{ ($.userIdentity.type = "Root") && ($.userIdentity.invokedBy NOT EXISTS) && ($.eventType != "AwsServiceEvent") }',
      ),
      logGroup: trailLogGroup,
      metricName: "RootAccountUsage",
      metricNamespace: "Yodev/Mail",
      metricValue: "1",
    });
    const rootUsageAlarm = rootUsage.metric({
      period: Duration.minutes(1),
      statistic: "Sum",
    }).createAlarm(this, "RootAccountUsageAlarm", {
      evaluationPeriods: 1,
      threshold: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
    rootUsageAlarm.addAlarmAction(new SnsAction(this.alertTopic));

    if (props.alertEmail) {
      this.alertTopic.addSubscription(new EmailSubscription(props.alertEmail));
    }

    const subscribers = props.alertEmail
      ? [{ address: props.alertEmail, subscriptionType: "EMAIL" }]
      : [];

    new CfnBudget(this, "AccountMonthlyBudget", {
      budget: {
        budgetName: "yodev-mail-account-monthly",
        budgetType: "COST",
        costTypes: {
          includeCredit: false,
          includeRefund: false,
        },
        timeUnit: "MONTHLY",
        budgetLimit: { amount: 10, unit: "USD" },
      },
      notificationsWithSubscribers: subscribers.length
        ? [
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 50,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "ACTUAL",
                threshold: 80,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
            {
              notification: {
                comparisonOperator: "GREATER_THAN",
                notificationType: "FORECASTED",
                threshold: 100,
                thresholdType: "PERCENTAGE",
              },
              subscribers,
            },
          ]
        : undefined,
    });

    if (props.guardDutyBudgetEmail) {
      const guardDutySubscribers = [
        { address: props.guardDutyBudgetEmail, subscriptionType: "EMAIL" },
      ];
      new CfnBudget(this, "GuardDutyMonthlyBudget", {
        budget: {
          budgetName: "yodev-mail-guardduty-monthly",
          budgetType: "COST",
          budgetLimit: { amount: 5, unit: "USD" },
          costFilters: { Service: ["Amazon GuardDuty"] },
          costTypes: {
            includeCredit: false,
            includeRefund: false,
          },
          timeUnit: "MONTHLY",
        },
        notificationsWithSubscribers: [
          {
            notification: {
              comparisonOperator: "GREATER_THAN",
              notificationType: "FORECASTED",
              threshold: 80,
              thresholdType: "PERCENTAGE",
            },
            subscribers: guardDutySubscribers,
          },
          {
            notification: {
              comparisonOperator: "GREATER_THAN",
              notificationType: "ACTUAL",
              threshold: 100,
              thresholdType: "PERCENTAGE",
            },
            subscribers: guardDutySubscribers,
          },
        ],
      });
    }

    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Product", "mail");
    Tags.of(this).add("Brand", "Yodev");
    Tags.of(this).add("managed-by", "aws-cdk");

    new CfnOutput(this, "OperationsAlertTopicArn", {
      value: this.alertTopic.topicArn,
    });
    new CfnOutput(this, "VercelOidcProviderArn", {
      value: this.vercelOidcProvider.openIdConnectProviderArn,
    });
  }
}
