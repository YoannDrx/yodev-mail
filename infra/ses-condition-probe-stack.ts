import { Duration, Stack, type StackProps, Tags } from "aws-cdk-lib";
import { ArnPrincipal, PolicyDocument, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { SES_PROBE_OPERATOR_ARN } from "./ses-probe-stack";
import { assertTestAccount } from "./test-account-stack";

export const SES_CONDITION_VARIANTS = ["baseline", "ownership", "tenant-like", "tenant-equals"] as const;

// Diagnostic controls, NOT candidate workload permissions. Exact resources and
// simulator-only destination make removing one condition safe for comparison.
export class YodevMailSesConditionProbeStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    assertTestAccount(props.env?.account, props.env?.region);
    super(scope, id, { ...props, terminationProtection: true });
    const prefix = `arn:aws:ses:${this.region}:${this.account}`;
    for (const variant of SES_CONDITION_VARIANTS) {
      const recipient = {
        "ForAllValues:StringEquals": { "ses:Recipients": ["success@simulator.amazonses.com"] },
        Null: { "ses:Recipients": "false" },
      };
      const tenant = variant === "tenant-like" ? { StringLike: { "ses:TenantName": "ym-dev-*" } }
        : variant === "tenant-equals" ? { StringEquals: { "ses:TenantName": "ym-dev-ses-probe-20260910a" } } : {};
      const ownership = variant === "ownership" ? { StringEquals: { "aws:ResourceTag/yodev:environment": "dev" } } : {};
      new Role(this, variant, {
        roleName: `yodev-mail-test-ses-condition-${variant}`,
        description: "Temporary simulator-only SES condition diagnostic on one exact test domain",
        assumedBy: new ArnPrincipal(SES_PROBE_OPERATOR_ARN),
        maxSessionDuration: Duration.hours(1),
        inlinePolicies: { DiagnosticOnly: new PolicyDocument({ statements: [
          new PolicyStatement({ actions: ["ses:SendEmail"], resources: [`${prefix}:identity/dev.ses-probe-20260910a.yodev.fr`], conditions: { ...recipient, ...tenant, ...ownership } }),
          new PolicyStatement({ actions: ["ses:SendEmail"], resources: [`${prefix}:configuration-set/ym-dev-ses-probe-20260910a-txn`], conditions: { ...recipient, ...tenant } }),
        ] }) },
      });
    }
    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Environment", "test");
    Tags.of(this).add("Purpose", "ses-condition-diagnostic");
  }
}
