import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { Rule } from "aws-cdk-lib/aws-events";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { CfnConfigurationSetEventDestination } from "aws-cdk-lib/aws-ses";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import type { Construct } from "constructs";
import { sanitizedSesEventInput, sesEventPattern } from "./ses-event-contract";
import { assertTestAccount } from "./test-account-stack";

export const TRANSPORT_PROBE_PREFIX = "yodev-mail-test-ses-transport";
export const TRANSPORT_PROBE_DESTINATION = "yodev-mail-transport-probe";
export const TRANSPORT_PROBE_RUN = "20260910a";

export class YodevMailSesTransportProbeStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps & { enabled?: boolean }) {
    assertTestAccount(props.env?.account, props.env?.region);
    super(scope, id, { ...props, terminationProtection: true });
    const key = new Key(this, "QueueKey", { enableKeyRotation: true, removalPolicy: RemovalPolicy.RETAIN });
    for (const environment of ["dev", "prod"] as const) {
      const queueName = `${TRANSPORT_PROBE_PREFIX}-${environment}`;
      const ruleArn = `arn:aws:events:${this.region}:${this.account}:rule/${queueName}`;
      const sourceConditions = { StringEquals: { "aws:SourceAccount": this.account }, ArnEquals: { "aws:SourceArn": ruleArn } };
      key.addToResourcePolicy(new PolicyStatement({
        principals: [new ServicePrincipal("events.amazonaws.com")],
        actions: ["kms:Decrypt", "kms:GenerateDataKey"], resources: ["*"], conditions: sourceConditions,
      }));
      const dlq = new Queue(this, `${environment}Dlq`, {
        queueName: `${queueName}-dlq`, encryption: QueueEncryption.KMS, encryptionMasterKey: key,
        enforceSSL: true, retentionPeriod: Duration.days(2), removalPolicy: RemovalPolicy.RETAIN,
      });
      const queue = new Queue(this, `${environment}Queue`, {
        queueName, encryption: QueueEncryption.KMS, encryptionMasterKey: key, enforceSSL: true,
        receiveMessageWaitTime: Duration.seconds(20), visibilityTimeout: Duration.seconds(60),
        retentionPeriod: Duration.days(1), deadLetterQueue: { queue: dlq, maxReceiveCount: 5 },
        removalPolicy: RemovalPolicy.RETAIN,
      });
      queue.addToResourcePolicy(new PolicyStatement({
        principals: [new ServicePrincipal("events.amazonaws.com")], actions: ["sqs:SendMessage"],
        resources: [queue.queueArn], conditions: sourceConditions,
      }));
      const configuration = `ym-${environment}-ses-probe-${TRANSPORT_PROBE_RUN}-txn`;
      const pattern = sesEventPattern(this.account, this.region, environment);
      pattern.detail!.mail.tags["ses:configuration-set"] = [configuration];
      const rule = new Rule(this, `${environment}Rule`, { ruleName: queueName, enabled: props.enabled === true, eventPattern: pattern });
      // Bind explicitly: no implicit broader service grants, and no target DLQ
      // which could retain the original, unsanitized SES event on delivery failure.
      rule.addTarget({ bind: () => {
        const input = sanitizedSesEventInput();
        return { arn: queue.queueArn, input, retryPolicy: { maximumRetryAttempts: 2, maximumEventAgeInSeconds: 60 } };
      } });
      const destination = new CfnConfigurationSetEventDestination(this, `${environment}Destination`, {
        configurationSetName: configuration,
        eventDestination: { name: TRANSPORT_PROBE_DESTINATION, enabled: props.enabled === true,
          matchingEventTypes: ["delivery"],
          eventBridgeDestination: { eventBusArn: `arn:aws:events:${this.region}:${this.account}:event-bus/default` } },
      });
      destination.node.addDependency(rule, queue);
      new CfnOutput(this, `${environment}QueueUrl`, { value: queue.queueUrl });
    }
    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Environment", "test");
    Tags.of(this).add("Purpose", "ses-transport-certification");
  }
}
