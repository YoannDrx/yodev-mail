import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps, Tags, Validations } from "aws-cdk-lib";
import { ReadWriteType, Trail } from "aws-cdk-lib/aws-cloudtrail";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

// Deliberately pinned: changing an env var must never target production.
export const TEST_ACCOUNT_ID = "764858776290";
export const TEST_REGION = "eu-west-3";

export function assertTestAccount(account: string | undefined, region: string | undefined) {
  if (account !== TEST_ACCOUNT_ID || region !== TEST_REGION) {
    throw new Error("Test infrastructure requires the dedicated test account in eu-west-3");
  }
}

export class YodevMailTestAuditStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    assertTestAccount(props.env?.account, props.env?.region);
    super(scope, id, { ...props, terminationProtection: true });
    // Names are referenced by encryption-context policies, avoiding dependency cycles.
    const trailName = "yodev-mail-test-management";
    const logName = "/aws/cloudtrail/yodev-mail-test-management";
    const trailArn = `arn:${this.partition}:cloudtrail:${this.region}:${this.account}:trail/${trailName}`;
    const logArn = `arn:${this.partition}:logs:${this.region}:${this.account}:log-group:${logName}`;
    const key = new Key(this, "AuditKey", {
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    key.addToResourcePolicy(new PolicyStatement({
      principals: [new ServicePrincipal(`logs.${this.region}.${this.urlSuffix}`)],
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      conditions: { ArnEquals: { "kms:EncryptionContext:aws:logs:arn": logArn } },
    }));
    key.addToResourcePolicy(new PolicyStatement({
      principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      conditions: {
        StringEquals: { "aws:SourceArn": trailArn },
        StringLike: { "kms:EncryptionContext:aws:cloudtrail:arn": trailArn },
      },
    }));
    const bucket = new Bucket(this, "AuditLogs", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.KMS,
      encryptionKey: key,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [{ expiration: Duration.days(365), noncurrentVersionExpiration: Duration.days(365) }],
    });
    const logs = new LogGroup(this, "AuditLogGroup", {
      logGroupName: logName,
      encryptionKey: key,
      retention: RetentionDays.ONE_YEAR,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const trail = new Trail(this, "ManagementTrail", {
      trailName,
      bucket,
      encryptionKey: key,
      cloudWatchLogGroup: logs,
      sendToCloudWatchLogs: true,
      enableFileValidation: true,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
      managementEvents: ReadWriteType.ALL,
    });
    // The L2 service grants do not constrain SourceArn. A deny keeps those
    // grants usable only by this exact trail, including after future additions.
    bucket.addToResourcePolicy(new PolicyStatement({
      effect: Effect.DENY,
      principals: [new ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["s3:GetBucketAcl", "s3:PutObject"],
      resources: [bucket.bucketArn, bucket.arnForObjects("*")],
      conditions: { StringNotEquals: { "aws:SourceArn": trailArn } },
    }));
    // No data events: no mail payload, attachment or recipient logging.
    Validations.of(bucket).acknowledge({
      id: "AwsSolutions-S1",
      reason: "This retained CloudTrail sink has no S3 server access logging. Management operations are audited by the trail; object-level reads are not audited. This scoped exception avoids a second log bucket for the temporary test account.",
    });
    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Environment", "test");
    Tags.of(this).add("managed-by", "aws-cdk");
    new CfnOutput(this, "TrailArn", { value: trail.trailArn, description: "Dedicated test account management audit trail" });
    new CfnOutput(this, "AuditBucketName", { value: bucket.bucketName, description: "Retained encrypted audit log bucket" });
    new CfnOutput(this, "AuditLogGroupName", { value: logs.logGroupName, description: "Encrypted management event log group" });
  }
}
