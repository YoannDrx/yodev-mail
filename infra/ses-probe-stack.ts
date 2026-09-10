import { CfnOutput, Duration, Stack, type StackProps, Tags, Validations } from "aws-cdk-lib";
import { ArnPrincipal, PolicyDocument, Role } from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";
import { sesPermissions } from "./ses-permissions";
import { assertTestAccount } from "./test-account-stack";

// Exact existing test-account SSO role, not an account-wide or wildcard trust.
export const SES_PROBE_OPERATOR_ARN = "arn:aws:iam::764858776290:role/aws-reserved/sso.amazonaws.com/eu-west-3/AWSReservedSSO_YoDevMailAdministrator_6a8c540c90c7f6b6";

export class YodevMailSesProbeStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    assertTestAccount(props.env?.account, props.env?.region);
    super(scope, id, { ...props, terminationProtection: true });
    for (const environment of ["dev", "prod"] as const) {
      const permissions = sesPermissions(this.account, this.region, environment);
      for (const kind of ["sender", "provisioner"] as const) {
        const role = new Role(this, `${environment}-${kind}`, {
          roleName: `yodev-mail-test-ses-${environment}-${kind}`,
          description: "Private SES IAM certification role in the dedicated test account",
          assumedBy: new ArnPrincipal(SES_PROBE_OPERATOR_ARN),
          maxSessionDuration: Duration.hours(1),
          inlinePolicies: { CandidateSes: new PolicyDocument({ statements: permissions[kind] }) },
        });
        const prefix = `arn:aws:ses:${this.region}:${this.account}`;
        const scopedPatterns = [`${prefix}:identity/*`, `${prefix}:configuration-set/ym-${environment}-*-txn`];
        if (kind === "provisioner") scopedPatterns.push(`${prefix}:tenant/ym-${environment}-*/*`);
        for (const resource of scopedPatterns) Validations.of(role).acknowledge({
          id: `AwsSolutions-IAM5[Resource::${resource}]`,
          reason: "Exact candidate SES ARN pattern under certification, scoped to this account/region and environment or identity ownership. Dynamic workspace resources require this pattern. No action wildcard or unrelated resource is acknowledged; runtime isolation remains to be proved.",
        });
        new CfnOutput(this, `${environment}-${kind}-arn`, { value: role.roleArn });
      }
    }
    Tags.of(this).add("Application", "yodev-mail");
    Tags.of(this).add("Environment", "test");
    Tags.of(this).add("Purpose", "ses-iam-certification");
  }
}
