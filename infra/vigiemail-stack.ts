import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Rule } from "aws-cdk-lib/aws-events";
import { SqsQueue } from "aws-cdk-lib/aws-events-targets";
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
} from "aws-cdk-lib/aws-s3";
import { CfnScheduleGroup } from "aws-cdk-lib/aws-scheduler";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";

export interface VigieMailStackProps extends StackProps {
  alertTopic: ITopic;
  environment: "dev" | "prod";
  vercelOidcProvider: IOpenIdConnectProvider;
  vercelTeam: string;
}

export class VigieMailStack extends Stack {
  constructor(scope: Construct, id: string, props: VigieMailStackProps) {
    super(scope, id, props);

    const prod = props.environment === "prod";
    const prefix = `vigiemail-${props.environment}`;
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
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(7) }],
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const databaseSecret = Secret.fromSecretNameV2(
      this,
      "DatabaseSecret",
      `${prefix}/database`,
    );
    const common = {
      bundling: { minify: true, sourceMap: true },
      environment: {
        AWS_REGION_NAME: this.region,
        DATABASE_URL: databaseSecret
          .secretValueFromJson("DATABASE_URL")
          .unsafeUnwrap(),
        NODE_OPTIONS: "--enable-source-maps",
        PUBLIC_LINKS_URL: prod
          ? "https://links.vigie-mail.fr"
          : "https://preview.vigie-mail.fr",
        UNSUBSCRIBE_SIGNING_SECRET: databaseSecret
          .secretValueFromJson("UNSUBSCRIBE_SIGNING_SECRET")
          .unsafeUnwrap(),
      },
      memorySize: 512,
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
    };

    const worker = (
      name: string,
      entry: string,
      extra: Record<string, string> = {},
      options: { reservedConcurrentExecutions?: number } = {},
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
        ...options,
        entry: path.join(process.cwd(), entry),
        environment: { ...common.environment, ...extra },
        functionName,
        handler: "handler",
        logGroup,
      });
      databaseSecret.grantRead(fn);
      const errors = fn
        .metricErrors({ period: Duration.minutes(5) })
        .createAlarm(this, `${name}ErrorsAlarm`, {
          evaluationPeriods: 1,
          threshold: 1,
        });
      errors.addAlarmAction(new SnsAction(props.alertTopic));
      return fn;
    };

    const send = worker(
      "SendEmail",
      "src/workers/send-email.ts",
      {},
      { reservedConcurrentExecutions: 1 },
    );
    send.addEventSource(
      new SqsEventSource(email.main, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );
    email.main.grantConsumeMessages(send);
    send.addToRolePolicy(
      new PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }),
    );

    const dispatch = worker(
      "CampaignDispatch",
      "src/workers/campaign-dispatch.ts",
      { EMAIL_QUEUE_URL: email.main.queueUrl },
    );
    dispatch.addEventSource(
      new SqsEventSource(campaign.main, {
        batchSize: 1,
        reportBatchItemFailures: true,
      }),
    );
    campaign.main.grantConsumeMessages(dispatch);
    email.main.grantSendMessages(dispatch);

    const ingest = worker("SesEvents", "src/workers/ses-events.ts", {
      WEBHOOK_QUEUE_URL: webhooks.main.queueUrl,
    });
    ingest.addEventSource(
      new SqsEventSource(events.main, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    events.main.grantConsumeMessages(ingest);
    webhooks.main.grantSendMessages(ingest);

    const deliver = worker(
      "CustomerWebhooks",
      "src/workers/deliver-webhook.ts",
    );
    deliver.addEventSource(
      new SqsEventSource(webhooks.main, {
        batchSize: 10,
        reportBatchItemFailures: true,
      }),
    );
    webhooks.main.grantConsumeMessages(deliver);

    const importer = worker("ImportContacts", "src/workers/import-contacts.ts", {
      IMPORT_BUCKET: imports.bucketName,
    });
    importer.addEventSource(
      new S3EventSource(imports, { events: [EventType.OBJECT_CREATED] }),
    );
    imports.grantRead(importer);

    new Rule(this, "SesEventRule", {
      eventPattern: { source: ["aws.ses"] },
      targets: [new SqsQueue(events.main)],
    });

    const vercelRole = new Role(this, "VercelRole", {
      assumedBy: new WebIdentityPrincipal(
        props.vercelOidcProvider.openIdConnectProviderArn,
        {
          StringEquals: {
            [`${oidcIssuer}:aud`]: oidcAudience,
            [`${oidcIssuer}:sub`]: `owner:${props.vercelTeam}:project:vigie-mail:environment:${
              prod ? "production" : "preview"
            }`,
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
          "ses:GetTenant",
          "ses:PutEmailIdentityMailFromAttributes",
        ],
        resources: ["*"],
      }),
    );

    for (const queuePair of [campaign, email, events, webhooks]) {
      const age = queuePair.main
        .metricApproximateAgeOfOldestMessage()
        .createAlarm(this, `${queuePair.main.node.id}AgeAlarm`, {
          evaluationPeriods: 2,
          threshold: 300,
        });
      age.addAlarmAction(new SnsAction(props.alertTopic));

      const dlqMessages = queuePair.dlq
        .metricApproximateNumberOfMessagesVisible()
        .createAlarm(this, `${queuePair.dlq.node.id}MessagesAlarm`, {
          evaluationPeriods: 1,
          threshold: 1,
        });
      dlqMessages.addAlarmAction(new SnsAction(props.alertTopic));

      new CfnOutput(this, `${queuePair.main.node.id}Url`, {
        value: queuePair.main.queueUrl,
      });
    }

    Tags.of(this).add("application", "vigiemail");
    Tags.of(this).add("environment", props.environment);
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
    new CfnOutput(this, "VercelRoleArn", { value: vercelRole.roleArn });
  }
}
