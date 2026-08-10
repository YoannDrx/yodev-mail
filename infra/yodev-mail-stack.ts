import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import {
  Dashboard as CloudWatchDashboard,
  GraphWidget,
  Metric,
  TreatMissingData,
} from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction, SqsQueue } from "aws-cdk-lib/aws-events-targets";
import {
  type IOpenIdConnectProvider,
  PolicyStatement,
  Role,
  ServicePrincipal,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import {
  S3EventSource,
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
  EventType,
  HttpMethods,
} from "aws-cdk-lib/aws-s3";
import { CfnScheduleGroup } from "aws-cdk-lib/aws-scheduler";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

export interface YodevMailStackProps extends StackProps {
  alertTopic: ITopic;
  environment: "dev" | "prod";
  vercelOidcProvider: IOpenIdConnectProvider;
  vercelTeam: string;
  standby: boolean;
}

export class YodevMailStack extends Stack {
  constructor(scope: Construct, id: string, props: YodevMailStackProps) {
    super(scope, id, props);

    const prod = props.environment === "prod";
    const monitoringEnabled = prod && !props.standby;
    const prefix = `yodev-mail-${props.environment}`;
    const oidcIssuer = `oidc.vercel.com/${props.vercelTeam}`;
    const oidcAudience = `https://vercel.com/${props.vercelTeam}`;

    const queue = (name: string, timeout = 60) => {
      const dlq = new Queue(this, `${name}Dlq`, {
        enforceSSL: true,
        encryption: QueueEncryption.SQS_MANAGED,
        queueName: `${prefix}-${name}-dlq`,
        retentionPeriod: Duration.days(14),
      });
      const main = new Queue(this, name, {
        deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
        enforceSSL: true,
        encryption: QueueEncryption.SQS_MANAGED,
        queueName: `${prefix}-${name}`,
        retentionPeriod: Duration.days(4),
        visibilityTimeout: Duration.seconds(timeout),
      });
      return { dlq, main };
    };

    const campaign = queue("campaign-dispatch", 300);
    const email = queue("email-send", 180);
    const events = queue("ses-events", 120);
    const webhooks = queue("customer-webhooks", 120);

    const scheduleGroup = new CfnScheduleGroup(this, "ScheduleGroup", {
      name: prefix,
    });
    const schedulerRole = new Role(this, "SchedulerRole", {
      assumedBy: new ServicePrincipal("scheduler.amazonaws.com"),
      roleName: `${prefix}-scheduler`,
    });
    campaign.main.grantSendMessages(schedulerRole);

    const imports = new Bucket(this, "Imports", {
      autoDeleteObjects: !prod,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: `${prefix}-imports-${this.account}`,
      cors: [
        {
          allowedHeaders: ["content-type"],
          allowedMethods: [HttpMethods.PUT],
          allowedOrigins: [
            "http://localhost:3000",
            "https://mail.yodev.fr",
            "https://*.vercel.app",
          ],
          exposedHeaders: ["etag"],
          maxAge: 300,
        },
      ],
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(7) }],
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const secureParameter = (id: string, name: string) =>
      StringParameter.fromSecureStringParameterAttributes(this, id, {
        parameterName: `/${prefix}/runtime/${name}`,
        version: 1,
      });
    const runtimeParameters = [
      secureParameter("DatabaseUrlParameter", "database-url"),
      secureParameter(
        "UnsubscribeSigningSecretParameter",
        "unsubscribe-signing-secret",
      ),
      secureParameter(
        "WebhookSigningSecretParameter",
        "webhook-signing-secret",
      ),
      secureParameter("StripeSecretKeyParameter", "stripe-secret-key"),
    ];
    const common = {
      bundling: { minify: true, sourceMap: true },
      environment: {
        AWS_REGION_NAME: this.region,
        NODE_OPTIONS: "--enable-source-maps",
        PUBLIC_LINKS_URL: prod
          ? "https://links.mail.yodev.fr"
          : "https://preview-mail.yodev.fr",
        RUNTIME_PARAMETER_PREFIX: `/${prefix}/runtime`,
      },
      memorySize: 512,
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
    };
    const workerFunctions: NodejsFunction[] = [];

    const worker = (
      name: string,
      entry: string,
      extra: Record<string, string> = {},
    ) => {
      const functionName = `${prefix}-${name.toLowerCase()}`;
      const logGroup = new LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        retention: prod
          ? RetentionDays.THREE_MONTHS
          : RetentionDays.ONE_MONTH,
      });
      const fn = new NodejsFunction(this, name, {
        ...common,
        entry: path.join(process.cwd(), entry),
        environment: { ...common.environment, ...extra },
        functionName,
        handler: "handler",
        logGroup,
      });
      for (const parameter of runtimeParameters) parameter.grantRead(fn);
      workerFunctions.push(fn);
      return fn;
    };

    const send = worker("SendEmail", "src/workers/send-email.ts");
    if (!props.standby) {
      send.addEventSource(
        new SqsEventSource(email.main, {
          batchSize: 1,
          maxConcurrency: 2,
          reportBatchItemFailures: true,
        }),
      );
    }
    email.main.grantConsumeMessages(send);
    send.addToRolePolicy(
      new PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }),
    );

    const dispatch = worker(
      "CampaignDispatch",
      "src/workers/campaign-dispatch.ts",
      { EMAIL_QUEUE_URL: email.main.queueUrl },
    );
    if (!props.standby) {
      dispatch.addEventSource(
        new SqsEventSource(campaign.main, {
          batchSize: 1,
          reportBatchItemFailures: true,
        }),
      );
    }
    campaign.main.grantConsumeMessages(dispatch);
    email.main.grantSendMessages(dispatch);

    const ingest = worker("SesEvents", "src/workers/ses-events.ts", {
      WEBHOOK_QUEUE_URL: webhooks.main.queueUrl,
    });
    if (!props.standby) {
      ingest.addEventSource(
        new SqsEventSource(events.main, {
          batchSize: 10,
          reportBatchItemFailures: true,
        }),
      );
    }
    events.main.grantConsumeMessages(ingest);
    webhooks.main.grantSendMessages(ingest);

    const deliver = worker(
      "CustomerWebhooks",
      "src/workers/deliver-webhook.ts",
    );
    if (!props.standby) {
      deliver.addEventSource(
        new SqsEventSource(webhooks.main, {
          batchSize: 10,
          reportBatchItemFailures: true,
        }),
      );
    }
    webhooks.main.grantConsumeMessages(deliver);

    const importer = worker("ImportContacts", "src/workers/import-contacts.ts", {
      IMPORT_BUCKET: imports.bucketName,
    });
    if (!props.standby) {
      importer.addEventSource(
        new S3EventSource(imports, { events: [EventType.OBJECT_CREATED] }),
      );
    }
    imports.grantRead(importer);

    const outbox = worker(
      "OutboxDispatch",
      "src/workers/outbox-dispatch.ts",
      {
        CAMPAIGN_QUEUE_URL: campaign.main.queueUrl,
        EMAIL_QUEUE_URL: email.main.queueUrl,
        WEBHOOK_QUEUE_URL: webhooks.main.queueUrl,
      },
    );
    campaign.main.grantSendMessages(outbox);
    email.main.grantSendMessages(outbox);
    webhooks.main.grantSendMessages(outbox);
    new Rule(this, "OutboxSchedule", {
      enabled: !props.standby,
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [new LambdaFunction(outbox)],
    });

    const domainHealth = worker(
      "DomainHealth",
      "src/workers/domain-health.ts",
    );
    domainHealth.addToRolePolicy(
      new PolicyStatement({ actions: ["ses:GetEmailIdentity"], resources: ["*"] }),
    );
    new Rule(this, "DomainHealthSchedule", {
      enabled: !props.standby,
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(domainHealth)],
    });

    const stripeUsage = worker(
      "StripeUsage",
      "src/workers/report-stripe-usage.ts",
      {
        STRIPE_METER_EVENT_NAME: "yodev_mail_emails_sent",
      },
    );
    new Rule(this, "StripeUsageSchedule", {
      enabled: !props.standby,
      schedule: Schedule.rate(Duration.hours(1)),
      targets: [new LambdaFunction(stripeUsage)],
    });

    const warmup = worker(
      "WarmupProgress",
      "src/workers/warmup-progress.ts",
    );
    new Rule(this, "WarmupProgressSchedule", {
      enabled: !props.standby,
      schedule: Schedule.cron({ hour: "1", minute: "15" }),
      targets: [new LambdaFunction(warmup)],
    });

    new Rule(this, "SesEventRule", {
      enabled: !props.standby,
      eventPattern: { source: ["aws.ses"] },
      targets: [new SqsQueue(events.main)],
    });

    const vercelRole = new Role(this, "VercelRole", {
      assumedBy: new WebIdentityPrincipal(
        props.vercelOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${oidcIssuer}:aud`]: oidcAudience,
            [`${oidcIssuer}:sub`]:
              `owner:${props.vercelTeam}:project:yodev-mail:environment:${prod ? "production" : "preview"}`,
          },
        },
      ),
      roleName: `${prefix}-vercel`,
    });
    email.main.grantSendMessages(vercelRole);
    campaign.main.grantSendMessages(vercelRole);
    imports.grantReadWrite(vercelRole);
    vercelRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "ses:CreateConfigurationSet",
          "ses:CreateConfigurationSetEventDestination",
          "ses:CreateEmailIdentity",
          "ses:CreateTenant",
          "ses:CreateTenantResourceAssociation",
          "ses:GetEmailIdentity",
          "ses:GetAccount",
          "ses:GetTenant",
          "ses:PutEmailIdentityMailFromAttributes",
        ],
        resources: ["*"],
      }),
    );

    for (const queuePair of [campaign, email, events, webhooks]) {
      if (monitoringEnabled) {
        const age = queuePair.main
          .metricApproximateAgeOfOldestMessage()
          .createAlarm(this, `${queuePair.main.node.id}AgeAlarm`, {
            evaluationPeriods: 2,
            threshold: 300,
            treatMissingData: TreatMissingData.NOT_BREACHING,
          });
        age.addAlarmAction(new SnsAction(props.alertTopic));

        const dlqMessages = queuePair.dlq
          .metricApproximateNumberOfMessagesVisible()
          .createAlarm(this, `${queuePair.dlq.node.id}MessagesAlarm`, {
            evaluationPeriods: 1,
            threshold: 1,
            treatMissingData: TreatMissingData.NOT_BREACHING,
          });
        dlqMessages.addAlarmAction(new SnsAction(props.alertTopic));
      }

      new CfnOutput(this, `${queuePair.main.node.id}Url`, {
        value: queuePair.main.queueUrl,
      });
    }

    const bounceRate = new Metric({
      metricName: "Reputation.BounceRate",
      namespace: "AWS/SES",
      period: Duration.minutes(5),
      statistic: "Average",
    });
    const complaintRate = new Metric({
      metricName: "Reputation.ComplaintRate",
      namespace: "AWS/SES",
      period: Duration.minutes(5),
      statistic: "Average",
    });
    if (monitoringEnabled) {
      const bounceAlarm = bounceRate.createAlarm(this, "SesBounceRateAlarm", {
        evaluationPeriods: 1,
        threshold: 0.05,
        treatMissingData: TreatMissingData.IGNORE,
      });
      const complaintAlarm = complaintRate.createAlarm(
        this,
        "SesComplaintRateAlarm",
        {
          evaluationPeriods: 1,
          threshold: 0.001,
          treatMissingData: TreatMissingData.IGNORE,
        },
      );
      bounceAlarm.addAlarmAction(new SnsAction(props.alertTopic));
      complaintAlarm.addAlarmAction(new SnsAction(props.alertTopic));
    }

    const dashboard = new CloudWatchDashboard(this, "OperationsDashboard", {
      dashboardName: `${prefix}-operations`,
    });
    dashboard.addWidgets(
      new GraphWidget({
        left: [
          new Metric({ metricName: "Send", namespace: "AWS/SES", statistic: "Sum" }),
          new Metric({ metricName: "Delivery", namespace: "AWS/SES", statistic: "Sum" }),
          new Metric({ metricName: "Bounce", namespace: "AWS/SES", statistic: "Sum" }),
          new Metric({ metricName: "Complaint", namespace: "AWS/SES", statistic: "Sum" }),
        ],
        title: "SES sending events",
        width: 12,
      }),
      new GraphWidget({
        left: [bounceRate, complaintRate],
        title: "SES account reputation",
        width: 12,
      }),
      new GraphWidget({
        left: [campaign, email, events, webhooks].map((pair) =>
          pair.main.metricApproximateAgeOfOldestMessage(),
        ),
        title: "Queue age",
        width: 12,
      }),
      new GraphWidget({
        left: workerFunctions.map((fn) => fn.metricErrors()),
        title: "Lambda errors",
        width: 12,
      }),
    );

    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Product", "mail");
    Tags.of(this).add("Brand", "Yodev");
    Tags.of(this).add("Environment", props.environment);
    Tags.of(this).add("managed-by", "aws-cdk");

    new CfnOutput(this, "CampaignQueueArn", {
      value: campaign.main.queueArn,
    });
    new CfnOutput(this, "DefaultEventBusArn", {
      value: `arn:aws:events:${this.region}:${this.account}:event-bus/default`,
    });
    new CfnOutput(this, "ImportsBucket", { value: imports.bucketName });
    new CfnOutput(this, "ScheduleGroupName", {
      value: scheduleGroup.name ?? prefix,
    });
    new CfnOutput(this, "SchedulerRoleArn", {
      value: schedulerRole.roleArn,
    });
    new CfnOutput(this, "StandbyMode", {
      value: String(props.standby),
    });
    new CfnOutput(this, "VercelRoleArn", { value: vercelRole.roleArn });
  }
}
