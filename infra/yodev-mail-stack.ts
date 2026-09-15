import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  Tags,
  Validations,
  type StackProps,
} from "aws-cdk-lib";
import { ComparisonOperator, Dashboard, GraphWidget, MathExpression, Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction, SqsQueue } from "aws-cdk-lib/aws-events-targets";
import { CfnMalwareProtectionPlan } from "aws-cdk-lib/aws-guardduty";
import {
  type IOpenIdConnectProvider,
  CfnRole,
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
import { BlockPublicAccess, Bucket, BucketEncryption, CfnBucket, HttpMethods, ObjectOwnership } from "aws-cdk-lib/aws-s3";
import { type ITopic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import type { Construct, IConstruct } from "constructs";
import { sesPermissions } from "./ses-permissions";
import { sanitizedSesEventInput, sesEventPattern } from "./ses-event-contract";

export interface YodevMailStackProps extends StackProps {
  alertTopic: ITopic;
  environment: "dev" | "prod";
  malwareProtectionEnabled?: boolean;
  postmarkEnabled?: boolean;
  sesEnabled?: boolean;
  stripeUsageReportingEnabled?: boolean;
  vercelOidcProvider: IOpenIdConnectProvider;
  vercelTeam: string;
  operatingMode: "standby" | "certification" | "live";
}

export class YodevMailStack extends Stack {
  constructor(scope: Construct, id: string, props: YodevMailStackProps) {
    super(scope, id, props);
    // Use source-scoped service policies for log delivery, never legacy S3 ACLs.
    this.node.setContext("@aws-cdk/aws-s3:serverAccessLogsUseBucketPolicy", true);
    const prod = props.environment === "prod";
    const standby = props.operatingMode === "standby";
    const monitoringEnabled = prod && !standby;
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
    const accessLogs = new Bucket(this, "S3AccessLogs", {
      objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    Validations.of(accessLogs).acknowledge({
      id: "AwsSolutions-S1",
      reason: "Dedicated S3 access-log destination. Logging its own deliveries would create recursive logs. Source attachment bucket logging is enabled; this private SSE-S3 sink retains logs for 90 days.",
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
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: "attachments/",
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    if (props.malwareProtectionEnabled) {
      const malwareRole = new Role(this, "GuardDutyMalwareRole", {
        assumedBy: new ServicePrincipal("malware-protection-plan.guardduty.amazonaws.com"),
        roleName: `${prefix}-guardduty-malware`,
      });
      // Match the service's documented scan/validation policy, not the broader
      // S3 read/write grants (which also permit bucket reads and multipart aborts).
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        resources: [attachmentBucket.arnForObjects("*")],
      }));
      malwareRole.addToPolicy(new PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [attachmentBucket.arnForObjects("malware-protection-resource-validation-object")],
      }));
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
    const runtimeParameters = {
      DATABASE_URL: secureParameter("DatabaseUrlParameter", "database-url"),
      WEBHOOK_SIGNING_SECRET: secureParameter("WebhookSigningSecretParameter", "webhook-signing-secret"),
      STRIPE_USAGE_SECRET_KEY: secureParameter("StripeUsageSecretKeyParameter", "stripe-usage-secret-key"),
    };
    const commonEnvironment = {
      ATTACHMENTS_BUCKET_NAME: attachmentBucket.bucketName,
      AWS_REGION_NAME: this.region,
      DEPLOYMENT_ENVIRONMENT: props.environment,
      NODE_OPTIONS: "--enable-source-maps",
      OPERATING_MODE: props.operatingMode,
      POSTMARK_ENABLED: props.postmarkEnabled && !standby ? "true" : "false",
      POSTMARK_WEBHOOK_BASE_URL: prod ? "https://mail.yodev.fr" : "",
      PROVIDER_CREDENTIALS_KMS_KEY_ARN: providerCredentialsKey.keyArn,
      RUNTIME_PARAMETER_PREFIX: `/${prefix}/runtime`,
      SES_ENABLED: props.sesEnabled && !standby ? "true" : "false",
    };
    const workerFunctions: NodejsFunction[] = [];
    const worker = (
      name: string,
      entry: string,
      extra: Record<string, string> = {},
      runtimeSecretNames: Array<keyof typeof runtimeParameters> = ["DATABASE_URL"],
    ) => {
      const functionName = `${prefix}-${name.toLowerCase()}`;
      const logGroup = new LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
        retention: prod ? RetentionDays.THREE_MONTHS : RetentionDays.ONE_MONTH,
      });
      const fn = new NodejsFunction(this, name, {
        // Pin the SDK used by SES tenant APIs to package-lock, not the runtime's
        // independently updated built-in SDK version.
        bundling: { minify: true, sourceMap: true, bundleAwsSDK: true },
        entry: path.join(process.cwd(), entry),
        environment: { ...commonEnvironment, ...extra },
        functionName,
        handler: "handler",
        logGroup,
        memorySize: 512,
        runtime: Runtime.NODEJS_24_X,
        timeout: Duration.seconds(60),
      });
      // Keep the existing ServiceRole construct/logical ID, but replace the
      // CDK default account-wide logging policy with this worker's log group.
      const serviceRole = fn.role?.node.defaultChild;
      if (!(serviceRole instanceof CfnRole)) throw new Error("Expected a generated worker service role");
      serviceRole.managedPolicyArns = undefined;
      logGroup.grantWrite(fn);
      for (const secretName of runtimeSecretNames) runtimeParameters[secretName].grantRead(fn);
      workerFunctions.push(fn);
      return fn;
    };
    const scheduledWorkerRule = (id: string, schedule: Schedule, fn: NodejsFunction, maintenance = false) => {
      const rule = new Rule(this, id, {
        enabled: maintenance || !standby,
        schedule,
        targets: [new LambdaFunction(fn, { retryAttempts: 0 })],
      });
      if (monitoringEnabled || (prod && maintenance)) {
        const failedInvocations = new Metric({
          namespace: "AWS/Events",
          metricName: "FailedInvocations",
          dimensionsMap: { RuleName: rule.ruleName },
          period: Duration.minutes(5),
          statistic: "Sum",
        });
        const alarm = failedInvocations.createAlarm(this, `${id}FailedInvocationAlarm`, {
          datapointsToAlarm: 2,
          evaluationPeriods: 3,
          threshold: 1,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        });
        alarm.addAlarmAction(new SnsAction(props.alertTopic));
      }
      return rule;
    };

    const send = worker("SendEmail", "src/workers/send-email.ts");
    if (!standby) send.addEventSource(new SqsEventSource(email.main, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));
    email.main.grantConsumeMessages(send);
    send.addToRolePolicy(new PolicyStatement({
      actions: ["s3:GetObject"],
      resources: [attachmentBucket.arnForObjects("*")],
      conditions: { StringEquals: { "s3:ExistingObjectTag/GuardDutyMalwareScanStatus": "NO_THREATS_FOUND" } },
    }));
    send.addToRolePolicy(new PolicyStatement({ actions: ["s3:DeleteObject"], resources: [attachmentBucket.arnForObjects("*")] }));
    attachmentKey.grantDecrypt(send);
    const sesPolicies = sesPermissions(this.account, this.region, props.environment);
    for (const policy of sesPolicies.sender) send.addToRolePolicy(policy);
    send.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantDecrypt(send);

    const ingest = worker("ProviderEvents", "src/workers/ses-events.ts");
    if (!standby) ingest.addEventSource(new SqsEventSource(providerEvents.main, { batchSize: 10, maxConcurrency: 2, reportBatchItemFailures: true }));
    providerEvents.main.grantConsumeMessages(ingest);

    const provision = worker("ProviderProvisioning", "src/workers/provider-provisioning.ts", {},);
    if (!standby) provision.addEventSource(new SqsEventSource(providerProvisioning.main, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));
    providerProvisioning.main.grantConsumeMessages(provision);
    provision.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:PutParameter"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grant(provision, "kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey");
    for (const policy of sesPolicies.provisioner) provision.addToRolePolicy(policy);

    const deliver = worker(
      "CustomerWebhooks",
      "src/workers/deliver-webhook.ts",
      {},
      ["DATABASE_URL", "WEBHOOK_SIGNING_SECRET"],
    );
    if (!standby) deliver.addEventSource(new SqsEventSource(webhooks.main, { batchSize: 10, maxConcurrency: 2, reportBatchItemFailures: true }));
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
    const clientProvisioning = worker(
      "ReconcileClientProvisioning",
      "src/workers/reconcile-client-provisioning.ts",
    );
    scheduledWorkerRule(
      "ReconcileClientProvisioningSchedule",
      Schedule.rate(Duration.minutes(5)),
      clientProvisioning,
    );

    const domainHealth = worker("DomainHealth", "src/workers/domain-health.ts");
    domainHealth.addToRolePolicy(new PolicyStatement({ actions: ["ses:GetEmailIdentity"], resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`] }));
    domainHealth.addToRolePolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantDecrypt(domainHealth);
    scheduledWorkerRule("DomainHealthSchedule", Schedule.rate(Duration.minutes(15)), domainHealth);

    const stripeUsage = worker(
      "StripeUsage",
      "src/workers/report-stripe-usage.ts",
      {
        STRIPE_METER_EVENT_NAME: "yodev_mail_emails_sent",
        STRIPE_USAGE_REPORTING_ENABLED:
          props.stripeUsageReportingEnabled && !standby ? "true" : "false",
      },
      ["DATABASE_URL", "STRIPE_USAGE_SECRET_KEY"],
    );
    scheduledWorkerRule("StripeUsageSchedule", Schedule.rate(Duration.hours(1)), stripeUsage);
    const warmup = worker("WarmupProgress", "src/workers/warmup-progress.ts");
    scheduledWorkerRule("WarmupProgressSchedule", Schedule.cron({ hour: "1", minute: "15" }), warmup);

    const scan = worker("AttachmentScan", "src/workers/attachment-scan.ts");
    scan.addToRolePolicy(new PolicyStatement({ actions: ["s3:GetObject"], resources: [attachmentBucket.arnForObjects("*")] }));
    attachmentKey.grantDecrypt(scan);
    new Rule(this, "AttachmentScanResultRule", {
      enabled: Boolean(props.malwareProtectionEnabled) && !standby,
      eventPattern: { source: ["aws.guardduty"], detailType: ["GuardDuty Malware Protection Object Scan Result"] },
      targets: [new LambdaFunction(scan)],
    });
    const purge = worker("AttachmentPurge", "src/workers/purge-attachments.ts");
    purge.addToRolePolicy(new PolicyStatement({ actions: ["s3:DeleteObject"], resources: [attachmentBucket.arnForObjects("*")] }));
    scheduledWorkerRule("AttachmentPurgeSchedule", Schedule.rate(Duration.minutes(30)), purge, true);
    const retention = worker("RetentionPurge", "src/workers/purge-retention.ts");
    scheduledWorkerRule("RetentionPurgeSchedule", Schedule.rate(Duration.minutes(30)), retention, true);
    // Privacy maintenance continues even while delivery and billing are paused.
    if (prod) {
      for (const [name, fn] of [["AttachmentPurge", purge], ["RetentionPurge", retention]] as const) {
        const failure = fn.metricErrors({ period: Duration.minutes(5), statistic: "Sum" }).createAlarm(this, `${name}MaintenanceFailure`, {
          threshold: 1, evaluationPeriods: 1, treatMissingData: TreatMissingData.NOT_BREACHING,
        });
        failure.addAlarmAction(new SnsAction(props.alertTopic));
      }
      for (const metricName of ["RetentionPurgeFailure", "RetentionPurgeBacklog", "RetentionPurgeCompleted"] as const) {
        const heartbeat = metricName === "RetentionPurgeCompleted";
        const alarm = new Metric({
          namespace: "Yodev/Mail", metricName, dimensionsMap: { Environment: props.environment },
          period: heartbeat ? Duration.hours(1) : Duration.minutes(15), statistic: "Sum",
        }).createAlarm(this, `${metricName}MaintenanceAlarm`, {
          threshold: 1, evaluationPeriods: 1,
          comparisonOperator: heartbeat ? ComparisonOperator.LESS_THAN_THRESHOLD : ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
          treatMissingData: heartbeat ? TreatMissingData.BREACHING : TreatMissingData.NOT_BREACHING,
        });
        alarm.addAlarmAction(new SnsAction(props.alertTopic));
      }
    }

    new Rule(this, "SesEventRule", {
      enabled: !standby,
      eventPattern: sesEventPattern(this.account, this.region, props.environment),
      targets: [new SqsQueue(providerEvents.main, {
        message: sanitizedSesEventInput(),
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
    providerEvents.main.grantSendMessages(vercelRole);
    providerProvisioning.main.grantSendMessages(vercelRole);
    // The authenticated domain refresh action checks SES directly from Vercel.
    vercelRole.addToPolicy(new PolicyStatement({
      actions: ["ses:GetEmailIdentity"],
      resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
    }));
    vercelRole.addToPolicy(new PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [attachmentBucket.arnForObjects("pending/*")],
    }));
    attachmentKey.grant(vercelRole, "kms:Encrypt", "kms:GenerateDataKey");
    vercelRole.addToPolicy(new PolicyStatement({ actions: ["ssm:GetParameter", "ssm:GetParameters"], resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`] }));
    providerCredentialsKey.grantDecrypt(vercelRole);

    // Acknowledge only individually reviewed resource patterns on their exact
    // role policy. A new wildcard action or unrelated resource must still fail.
    const acknowledgePattern = (role: IConstruct, pattern: string, reason: string) => {
      Validations.of(role.node.findChild("DefaultPolicy")).acknowledge({
        id: `AwsSolutions-IAM5[Resource::${pattern}]`, reason,
      });
    };
    const attachmentArnReference = `<${this.getLogicalId(attachmentBucket.node.defaultChild as CfnBucket)}.Arn>`;
    for (const role of [send.role!, scan.role!, purge.role!]) {
      acknowledgePattern(role, `${attachmentArnReference}/*`, "Only objects in this workload's dedicated encrypted attachment bucket. Opaque keys are tenant-scoped in application operations; exact GetObject/DeleteObject actions are used. Sending also requires a clean malware tag.");
    }
    acknowledgePattern(vercelRole, `${attachmentArnReference}/pending/*`, "Ingress can upload only dynamically named pending objects in this workload bucket. It has no attachment read, decrypt or send permission; upload authorization is checked per workspace.");
    for (const role of [send.role!, provision.role!, domainHealth.role!, vercelRole]) {
      acknowledgePattern(role, `arn:aws:ssm:${this.region}:${this.account}:parameter/${prefix}/providers/*`, "Provider credentials are provisioned per workspace below this exact account/region/environment SSM prefix. Runtime parameters use separately enumerated ARNs; application tenant ownership is verified before selecting a provider credential.");
      acknowledgePattern(role, `arn:aws:ses:${this.region}:${this.account}:identity/*`, "Verified sender domains are dynamic in this SES account and region. Each role has enumerated operations. SendEmail is constrained by environment TenantName and SES tenant membership; association writes require environment ownership tags. This is not a separate AWS-account isolation boundary.");
    }
    for (const role of [send.role!, provision.role!]) {
      acknowledgePattern(role, `arn:aws:ses:${this.region}:${this.account}:configuration-set/ym-${props.environment}-*-txn`, "Only transactional configuration sets generated from workspace UUIDs in this deployment environment. The exact pattern is shared by provisioning and sending and protected by tests in ses-permissions.");
    }
    acknowledgePattern(provision.role!, `arn:aws:ses:${this.region}:${this.account}:tenant/ym-${props.environment}-*/*`, "SES tenant ARNs contain a generated tenant ID and workspace UUID name. Provisioning is limited to this account, region and environment name prefix; application ownership validation rejects legacy or cross-environment bindings.");
    const malwareRole = this.node.tryFindChild("GuardDutyMalwareRole");
    if (malwareRole) {
      acknowledgePattern(malwareRole, `${attachmentArnReference}/*`, "GuardDuty scans and tags dynamic objects only in this workload bucket, using enumerated read/tag operations. Object PUT is separately limited to its validation object. See AWS malware-protection-s3-iam-policy-prerequisite documentation.");
      acknowledgePattern(malwareRole, `arn:aws:events:${this.region}:${this.account}:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`, "AWS GuardDuty generates its managed EventBridge rule name. The documented service-specific prefix is limited to this account/region, and all rule mutations require the GuardDuty events:ManagedBy condition.");
    }

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
    const clientProvisioningFailures = new Metric({ metricName: "ClientProvisioningReconciliationFailed", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    const unknownOutcomes = new Metric({ metricName: "ProviderOutcomeUnknown", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    const webhookTerminalFailures = new Metric({ metricName: "CustomerWebhookTerminalFailure", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    const purgeFailures = new Metric({ metricName: "AttachmentPurgeFailure", namespace: "Yodev/Mail", dimensionsMap: { Environment: props.environment }, period: Duration.minutes(5), statistic: "Sum" });
    if (monitoringEnabled) {
      const bounce = bounceRate.createAlarm(this, "SesBounceRateAlarm", { evaluationPeriods: 1, threshold: 0.02, treatMissingData: TreatMissingData.IGNORE });
      const complaint = complaintRate.createAlarm(this, "SesComplaintRateAlarm", { evaluationPeriods: 1, threshold: 0.001, treatMissingData: TreatMissingData.IGNORE });
      bounce.addAlarmAction(new SnsAction(props.alertTopic));
      complaint.addAlarmAction(new SnsAction(props.alertTopic));
      const malware = attachmentRejections.createAlarm(this, "AttachmentScanRejectedAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const clientProvisioningFailure = clientProvisioningFailures.createAlarm(this, "ClientProvisioningReconciliationFailedAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const unknown = unknownOutcomes.createAlarm(this, "ProviderOutcomeUnknownAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const purgeFailure = purgeFailures.createAlarm(this, "AttachmentPurgeFailureAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const webhookTerminal = webhookTerminalFailures.createAlarm(this, "CustomerWebhookTerminalFailureAlarm", { evaluationPeriods: 1, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      const billingFailure = stripeUsage.metricErrors({ period: Duration.minutes(5) }).createAlarm(this, "StripeUsageFailureAlarm", { datapointsToAlarm: 2, evaluationPeriods: 3, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
      malware.addAlarmAction(new SnsAction(props.alertTopic));
      clientProvisioningFailure.addAlarmAction(new SnsAction(props.alertTopic));
      unknown.addAlarmAction(new SnsAction(props.alertTopic));
      purgeFailure.addAlarmAction(new SnsAction(props.alertTopic));
      webhookTerminal.addAlarmAction(new SnsAction(props.alertTopic));
      billingFailure.addAlarmAction(new SnsAction(props.alertTopic));
      for (const fn of workerFunctions) {
        const period = Duration.minutes(5);
        const errorRate = new MathExpression({
          expression: "IF(invocations > 0, 100 * errors / invocations, 0)",
          label: `${fn.node.id} error rate`,
          period,
          usingMetrics: {
            errors: fn.metricErrors({ period }),
            invocations: fn.metricInvocations({ period }),
          },
        });
        const errorAlarm = errorRate.createAlarm(this, `${fn.node.id}ErrorRateAlarm`, { datapointsToAlarm: 2, evaluationPeriods: 3, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
        const throttleAlarm = fn.metricThrottles({ period }).createAlarm(this, `${fn.node.id}ThrottleAlarm`, { datapointsToAlarm: 2, evaluationPeriods: 3, threshold: 1, treatMissingData: TreatMissingData.NOT_BREACHING });
        const durationAlarm = fn.metricDuration({ period, statistic: "p99" }).createAlarm(this, `${fn.node.id}DurationP99Alarm`, { datapointsToAlarm: 2, evaluationPeriods: 3, threshold: 48_000, treatMissingData: TreatMissingData.NOT_BREACHING });
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
      new GraphWidget({ left: [attachmentRejections, clientProvisioningFailures, unknownOutcomes, purgeFailures, webhookTerminalFailures], title: "Security and ambiguous outcomes", width: 12 }),
    );

    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Product", "mail");
    Tags.of(this).add("Brand", "Yodev");
    Tags.of(this).add("Environment", props.environment);
    Tags.of(this).add("managed-by", "aws-cdk");
    new CfnOutput(this, "AttachmentsBucket", { value: attachmentBucket.bucketName });
    new CfnOutput(this, "DefaultEventBusArn", { value: `arn:aws:events:${this.region}:${this.account}:event-bus/default` });
    new CfnOutput(this, "OperatingMode", { value: props.operatingMode });
    new CfnOutput(this, "StandbyMode", { value: String(standby) });
    new CfnOutput(this, "VercelRoleArn", { value: vercelRole.roleArn });
  }
}
