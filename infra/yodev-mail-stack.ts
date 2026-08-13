import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  type StackProps,
} from "aws-cdk-lib";
import { Dashboard, GraphWidget, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { EventField, Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction, SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { CfnMalwareProtectionPlan } from "aws-cdk-lib/aws-guardduty";
import {
  type IOpenIdConnectProvider,
  PolicyStatement,
  Role,
  ServicePrincipal,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

export interface YodevMailStackProps extends StackProps {
  alertTopic: ITopic;
  environment: "dev" | "prod";
  malwareProtectionEnabled?: boolean;
  postmarkEnabled?: boolean;
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

    const email = queue("email-send", 420);
    const providerEvents = queue("provider-events", 360);
    const providerProvisioning = queue("provider-provisioning", 420);
    const webhooks = queue("customer-webhooks", 360);
    const queues = [email, providerEvents, providerProvisioning, webhooks];

    const attachmentKey = new Key(this, "AttachmentKey", {
      alias: `${prefix}-attachments`,
      enableKeyRotation: true,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const providerCredentialsKey = new Key(this, "ProviderCredentialsKey", {
      alias: `${prefix}-provider-credentials`,
      enableKeyRotation: true,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const attachmentBucket = new Bucket(this, "Attachments", {
      autoDeleteObjects: !prod,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      bucketName: `${prefix}-attachments-${this.account}`,
      cors: [{
        allowedHeaders: ["content-type", "x-amz-checksum-sha256"],
        allowedMethods: [HttpMethods.PUT],
        allowedOrigins: ["http://localhost:3000", "https://mail.yodev.fr", "https://*.vercel.app"],
        exposedHeaders: ["etag", "x-amz-checksum-sha256"],
        maxAge: 300,
      }],
      encryption: BucketEncryption.KMS,
      encryptionKey: attachmentKey,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(1) }],
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    if (props.malwareProtectionEnabled) {
      const malwareRole = new Role(this, "GuardDutyMalwareRole", {
        assumedBy: new ServicePrincipal("malware-protection-plan.guardduty.amazonaws.com"),
        roleName: `${prefix}-guardduty-malware`,
      });
      attachmentBucket.grantRead(malwareRole);
      attachmentBucket.grantPut(malwareRole);
      attachmentKey.grantDecrypt(malwareRole);
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["s3:GetObjectTagging", "s3:PutObjectTagging", "s3:GetObjectVersionTagging", "s3:PutObjectVersionTagging"],
        resources: [attachmentBucket.arnForObjects("*")],
      }));
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["events:PutRule", "events:DeleteRule", "events:PutTargets", "events:RemoveTargets"],
        resources: [`arn:aws:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`],
        conditions: { StringLike: { "events:ManagedBy": "malware-protection-plan.guardduty.amazonaws.com" } },
      }));
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["events:DescribeRule", "events:ListTargetsByRule"],
        resources: [`arn:aws:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`],
      }));
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["s3:PutBucketNotification", "s3:GetBucketNotification", "s3:ListBucket"],
        resources: [attachmentBucket.bucketArn],
      }));
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["kms:GenerateDataKey", "kms:Decrypt"],
        resources: [attachmentKey.keyArn],
        conditions: { StringLike: { "kms:ViaService": `s3.${this.region}.amazonaws.com` } },
      }));
      const protectionPlan = new CfnMalwareProtectionPlan(this, "AttachmentMalwareProtection", {
        actions: { tagging: { status: "ENABLED" } },
        protectedResource: { s3Bucket: { bucketName: attachmentBucket.bucketName, objectPrefixes: ["pending/"] } },
        role: malwareRole.roleArn,
        tags: [{ key: "Application", value: "yodev-mail" }],
      });
      protectionPlan.node.addDependency(attachmentBucket, malwareRole);
    }

    const secureParameter = (id: string, name: string) => StringParameter.fromSecureStringParameterAttributes(this, id, {
      parameterName: `/${prefix}/runtime/${name}`,
      version: 1,
    });
    const runtimeParameters = [
      secureParameter("DatabaseUrlParameter", "database-url"),
      secureParameter("WebhookSigningSecretParameter", "webhook-signing-secret"),
      secureParameter("StripeSecretKeyParameter", "stripe-secret-key"),
    ];
    const commonEnvironment = {
      ATTACHMENTS_BUCKET_NAME: attachmentBucket.bucketName,
      AWS_REGION_NAME: this.region,
      DEPLOYMENT_ENVIRONMENT: props.environment,
      NODE_OPTIONS: "--enable-source-maps",
      POSTMARK_ENABLED: props.postmarkEnabled ? "true" : "false",
      POSTMARK_WEBHOOK_BASE_URL: prod ? "https://mail.yodev.fr" : "",
      PROVIDER_CREDENTIALS_KMS_KEY_ARN: providerCredentialsKey.keyArn,
      RUNTIME_PARAMETER_PREFIX: `/${prefix}/runtime`,
      SES_ENABLED: prod ? "false" : "true",
    };
    const workerFunctions: NodejsFunction[] = [];
    const worker = (name: string, entry: string, extra: Record<string, string> = {}) => {
      const functionName = `${prefix}-${name.toLowerCase()}`;
      const logGroup = new LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        retention: prod ? RetentionDays.THREE_MONTHS : RetentionDays.ONE_MONTH,
      });
      const fn = new NodejsFunction(this, name, {
        bundling: { minify: true, sourceMap: true },
        entry: path.join(process.cwd(), entry),
        environment: { ...commonEnvironment, ...extra },
        functionName,
        handler: "handler",
        logGroup,
        memorySize: 512,
        runtime: Runtime.NODEJS_22_X,
        timeout: Duration.seconds(60),
      });
      for (const parameter of runtimeParameters) parameter.grantRead(fn);
      workerFunctions.push(fn);
      return fn;
    };
    const scheduledWorkerRule = (id: string, schedule: Schedule, fn: NodejsFunction) => {
      const rule = new Rule(this, id, { enabled: !props.standby, schedule, targets: [new LambdaFunction(fn)] });
      if (monitoringEnabled) {
        const failedInvocations = new Metric({
          namespace: "AWS/Events",
          metricName: "FailedInvocations",
          dimensionsMap: { RuleName: rule.ruleName },
          period: Duration.minutes(5),
          statistic: "Sum",
        });
        const alarm = failedInvocations.createAlarm(this, `${id}FailedInvocationAlarm`, {
          evaluationPeriods: 1,
          threshold: 1,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        });
        alarm.addAlarmAction(new SnsAction(props.alertTopic));
      }
      return rule;
    };

    const send = worker("SendEmail", "src/workers/send-email.ts");
    if (!props.standby) send.addEventSource(new SqsEventSource(email.main, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));
    email.main.grantConsumeMessages(send);
    send.addToRolePolicy(new PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [attachmentBucket.arnForObjects("*")],
      conditions: { StringEquals: { "s3:ExistingObjectTag/GuardDutyMalwareScanStatus": "NO_THREATS_FOUND" } },
    }));
    attachmentBucket.grantDelete(send);
    attachmentKey.grantDecrypt(send);
    send.addToRolePolicy(new PolicyStatement({ actions: ["ses:SendEmail"], resources: ["*"] }));
    send.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantDecrypt(send);

    const ingest = worker("ProviderEvents", "src/workers/ses-events.ts");
    if (!props.standby) ingest.addEventSource(new SqsEventSource(providerEvents.main, { batchSize: 10, maxConcurrency: 2, reportBatchItemFailures: true }));
    providerEvents.main.grantConsumeMessages(ingest);

    const provision = worker("ProviderProvisioning", "src/workers/provider-provisioning.ts", {},);
    if (!props.standby) provision.addEventSource(new SqsEventSource(providerProvisioning.main, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));
    providerProvisioning.main.grantConsumeMessages(provision);
    provision.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantEncryptDecrypt(provision);
    provision.addToRolePolicy(new PolicyStatement({ actions: ["ses:CreateConfigurationSet", "ses:CreateConfigurationSetEventDestination", "ses:CreateEmailIdentity", "ses:CreateTenant", "ses:CreateTenantResourceAssociation", "ses:GetEmailIdentity", "ses:GetTenant", "ses:PutEmailIdentityMailFromAttributes", "ses:UpdateReputationEntityPolicy"], resources: ["*"] }));

    const deliver = worker("CustomerWebhooks", "src/workers/deliver-webhook.ts");
    if (!props.standby) deliver.addEventSource(new SqsEventSource(webhooks.main, { batchSize: 10, maxConcurrency: 2, reportBatchItemFailures: true }));
    webhooks.main.grantConsumeMessages(deliver);

    const outbox = worker("OutboxDispatch", "src/workers/outbox-dispatch.ts", {
      EMAIL_QUEUE_URL: email.main.queueUrl,
      WEBHOOK_QUEUE_URL: webhooks.main.queueUrl,
    });
    email.main.grantSendMessages(outbox);
    webhooks.main.grantSendMessages(outbox);
    scheduledWorkerRule("OutboxSchedule", Schedule.rate(Duration.minutes(1)), outbox);

    const staleSending = worker("RecoverStaleSending", "src/workers/recover-stale-sending.ts");
    scheduledWorkerRule("RecoverStaleSendingSchedule", Schedule.rate(Duration.minutes(5)), staleSending);

    const domainHealth = worker("DomainHealth", "src/workers/domain-health.ts");
    domainHealth.addToRolePolicy(new PolicyStatement({ actions: ["ses:GetEmailIdentity"], resources: ["*"] }));
    domainHealth.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantDecrypt(domainHealth);
    scheduledWorkerRule("DomainHealthSchedule", Schedule.rate(Duration.minutes(15)), domainHealth);

    const stripeUsage = worker("StripeUsage", "src/workers/report-stripe-usage.ts", { STRIPE_METER_EVENT_NAME: "yodev_mail_emails_sent" });
    scheduledWorkerRule("StripeUsageSchedule", Schedule.rate(Duration.hours(1)), stripeUsage);
    const warmup = worker("WarmupProgress", "src/workers/warmup-progress.ts");
    scheduledWorkerRule("WarmupProgressSchedule", Schedule.cron({ hour: "1", minute: "15" }), warmup);

    const scan = worker("AttachmentScan", "src/workers/attachment-scan.ts");
    attachmentBucket.grantRead(scan);
    attachmentKey.grantDecrypt(scan);
    new Rule(this, "AttachmentScanResultRule", {
      enabled: Boolean(props.malwareProtectionEnabled),
      eventPattern: { source: ["aws.guardduty"], detailType: ["GuardDuty Malware Protection Object Scan Result"] },
      targets: [new LambdaFunction(scan)],
    });
    const purge = worker("AttachmentPurge", "src/workers/purge-attachments.ts");
    attachmentBucket.grantDelete(purge);
    scheduledWorkerRule("AttachmentPurgeSchedule", Schedule.rate(Duration.hours(1)), purge);
    const retention = worker("RetentionPurge", "src/workers/purge-retention.ts");
    scheduledWorkerRule("RetentionPurgeSchedule", Schedule.cron({ hour: "2", minute: "30" }), retention);

    new Rule(this, "SesEventRule", {
      enabled: !props.standby,
      eventPattern: {
        source: ["aws.ses"],
        detail: {
          eventType: ["Delivery", "Bounce", "Complaint", "Reject", "DeliveryDelay"],
          mail: { tags: { ym_workspace_id: [{ exists: true }], ym_message_id: [{ exists: true }] } },
        },
      },
      targets: [new SqsQueue(providerEvents.main, {
        message: RuleTargetInput.fromObject({
          eventId: EventField.eventId,
          eventType: EventField.fromPath("$.detail.eventType"),
          providerMessageId: EventField.fromPath("$.detail.mail.messageId"),
          messageId: EventField.fromPath("$.detail.mail.tags.ym_message_id[0]"),
          workspaceId: EventField.fromPath("$.detail.mail.tags.ym_workspace_id[0]"),
          occurredAt: EventField.fromPath("$.detail.mail.timestamp"),
          bounceType: EventField.fromPath("$.detail.bounce.bounceType"),
        }),
      })],
    });

    const vercelRole = new Role(this, "VercelRole", {
      assumedBy: new WebIdentityPrincipal(props.vercelOidcProvider.openIdConnectProviderArn, {
        StringEquals: {
          [`${oidcIssuer}:aud`]: oidcAudience,
          [`${oidcIssuer}:sub`]: `owner:${props.vercelTeam}:project:yodev-mail:environment:${prod ? "production" : "preview"}`,
        },
      }),
      roleName: `${prefix}-vercel`,
    });
    email.main.grantSendMessages(vercelRole);
    providerEvents.main.grantSendMessages(vercelRole);
    providerProvisioning.main.grantSendMessages(vercelRole);
    attachmentBucket.grantPut(vercelRole);
    attachmentKey.grantEncrypt(vercelRole);
    vercelRole.addToPolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantDecrypt(vercelRole);

    for (const pair of queues) {
      if (monitoringEnabled) {
        const age = pair.main.metricApproximateAgeOfOldestMessage().createAlarm(this, `${pair.main.node.id}AgeAlarm`, { evaluationPeriods: 2, threshold: 300, treatMissingData: TreatMissingData.NOT_BREACHING });
        age.addAlarmAction(new SnsAction(props.alertTopic));
        const dlq = pair.dlq.metricApproximateNumberOfMessagesVisible().createAlarm(this, `${pair.dlq.node.id}MessagesAlarm`, { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
        dlq.addAlarmAction(new SnsAction(props.alertTopic));
      }
      new CfnOutput(this, `${pair.main.node.id}Url`, { value: pair.main.queueUrl });
    }

    const bounceRate = new Metric({ metricName: "Reputation.BounceRate", namespace: "AWS/SES", period: Duration.minutes(5), statistic: "Average" });
    const complaintRate = new Metric({ metricName: "Reputation.ComplaintRate", namespace: "AWS/SES", period: Duration.minutes(5), statistic: "Average" });
    const attachmentRejections = new Metric({ metricName: "AttachmentScanRejected", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    const unknownOutcomes = new Metric({ metricName: "ProviderOutcomeUnknown", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    const webhookTerminalFailures = new Metric({ metricName: "CustomerWebhookTerminalFailure", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    const purgeFailures = new Metric({ metricName: "AttachmentPurgeFailure", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    if (monitoringEnabled) {
      const bounce = bounceRate.createAlarm(this, "SesBounceRateAlarm", { evaluationPeriods: 1, threshold: 0.02, treatMissingData: TreatMissingData.IGNORE });
      const complaint = complaintRate.createAlarm(this, "SesComplaintRateAlarm", { evaluationPeriods: 1, threshold: 0.001, treatMissingData: TreatMissingData.IGNORE });
      bounce.addAlarmAction(new SnsAction(props.alertTopic));
      complaint.addAlarmAction(new SnsAction(props.alertTopic));
      const malware = attachmentRejections.createAlarm(this, "AttachmentScanRejectedAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const unknown = unknownOutcomes.createAlarm(this, "ProviderOutcomeUnknownAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const purgeFailure = purgeFailures.createAlarm(this, "AttachmentPurgeFailureAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const webhookTerminal = webhookTerminalFailures.createAlarm(this, "CustomerWebhookTerminalFailureAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const billingFailure = stripeUsage.metricErrors().createAlarm(this, "StripeUsageFailureAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      malware.addAlarmAction(new SnsAction(props.alertTopic));
      unknown.addAlarmAction(new SnsAction(props.alertTopic));
      purgeFailure.addAlarmAction(new SnsAction(props.alertTopic));
      webhookTerminal.addAlarmAction(new SnsAction(props.alertTopic));
      billingFailure.addAlarmAction(new SnsAction(props.alertTopic));
      for (const fn of workerFunctions) {
        const errorAlarm = fn.metricErrors().createAlarm(this, `${fn.node.id}ErrorAlarm`, { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
        const throttleAlarm = fn.metricThrottles().createAlarm(this, `${fn.node.id}ThrottleAlarm`, { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
        const durationAlarm = fn.metricDuration({ statistic: "p99" }).createAlarm(this, `${fn.node.id}DurationP99Alarm`, { evaluationPeriods: 2, threshold: 48_000, treatMissingData: TreatMissingData.NOT_BREACHING });
        errorAlarm.addAlarmAction(new SnsAction(props.alertTopic));
        throttleAlarm.addAlarmAction(new SnsAction(props.alertTopic));
        durationAlarm.addAlarmAction(new SnsAction(props.alertTopic));
      }
    }
    const dashboard = new Dashboard(this, "OperationsDashboard", { dashboardName: `${prefix}-operations` });
    dashboard.addWidgets(
      new GraphWidget({ left: queues.map((pair) => pair.main.metricApproximateAgeOfOldestMessage()), title: "Provider-neutral queue age", width: 12 }),
      new GraphWidget({ left: workerFunctions.map((fn) => fn.metricErrors()), title: "Lambda errors", width: 12 }),
      new GraphWidget({ left: [bounceRate, complaintRate], title: "SES account reputation", width: 12 }),
      new GraphWidget({ left: [attachmentRejections, unknownOutcomes, purgeFailures, webhookTerminalFailures], title: "Security and ambiguous outcomes", width: 12 }),
    );

    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Product", "mail");
    Tags.of(this).add("Brand", "Yodev");
    Tags.of(this).add("Environment", props.environment);
    Tags.of(this).add("managed-by", "aws-cdk");
    new CfnOutput(this, "AttachmentsBucket", { value: attachmentBucket.bucketName });
    new CfnOutput(this, "DefaultEventBusArn", { value: `arn:aws:events:${this.region}:${this.account}:event-bus/default` });
    new CfnOutput(this, "StandbyMode", { value: String(props.standby) });
    new CfnOutput(this, "VercelRoleArn", { value: vercelRole.roleArn });
  }
}
