import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { SES_ENVIRONMENT_TAG } from "../src/features/providers/ses-resources";

// Shared by workload roles and isolated certification roles. Keep a single
// candidate policy so a successful probe cannot certify a divergent copy.
export function sesPermissions(account: string, region: string, environment: "dev" | "prod") {
  const prefix = `arn:aws:ses:${region}:${account}`;
  const identity = `${prefix}:identity/*`;
  const configuration = `${prefix}:configuration-set/ym-${environment}-*-txn`;
  const tenant = `${prefix}:tenant/ym-${environment}-*/*`;
  const ownership = { [`aws:ResourceTag/${SES_ENVIRONMENT_TAG}`]: environment };
  const tenantCondition = { "ses:TenantName": `ym-${environment}-*` };
  return {
    sender: [
      // Real SES SendEmail rejects even owned, tagged domains with ResourceTag
      // conditions. TenantName is enforced by IAM; SES validates that the domain
      // belongs to that tenant. Ownership remains mandatory on association writes
      // below. Audit legacy associations before activation; tags alone are not an
      // authorization boundary for sending, and retagging cannot move membership.
      new PolicyStatement({ actions: ["ses:SendEmail"], resources: [identity], conditions: { StringLike: tenantCondition } }),
      new PolicyStatement({ actions: ["ses:SendEmail"], resources: [configuration], conditions: { StringLike: tenantCondition } }),
    ],
    provisioner: [
      new PolicyStatement({ actions: ["ses:CreateConfigurationSet", "ses:CreateConfigurationSetEventDestination", "ses:UpdateConfigurationSetEventDestination"], resources: [configuration] }),
      new PolicyStatement({ actions: ["ses:CreateTenant", "ses:GetTenant"], resources: [tenant] }),
      new PolicyStatement({ actions: ["ses:CreateTenantResourceAssociation"], resources: [tenant, configuration] }),
      new PolicyStatement({ actions: ["ses:CreateTenantResourceAssociation", "ses:PutEmailIdentityMailFromAttributes"], resources: [identity], conditions: { StringEquals: ownership } }),
      new PolicyStatement({ actions: ["ses:GetEmailIdentity"], resources: [identity] }),
      new PolicyStatement({ actions: ["ses:CreateEmailIdentity"], resources: [identity], conditions: { StringEquals: { [`aws:RequestTag/${SES_ENVIRONMENT_TAG}`]: environment } } }),
      // Creation tagging can also adopt untagged legacy identities through a
      // direct API call. Inventory ownership before activation; never retag
      // another environment or grant general tagging/untagging privileges.
      new PolicyStatement({
        actions: ["ses:TagResource"], resources: [identity],
        conditions: {
          StringEquals: { [`aws:RequestTag/${SES_ENVIRONMENT_TAG}`]: environment },
          StringEqualsIfExists: ownership,
          "ForAllValues:StringEquals": { "aws:TagKeys": [SES_ENVIRONMENT_TAG] },
        },
      }),
      new PolicyStatement({ actions: ["ses:UpdateReputationEntityPolicy"], resources: [tenant, `arn:aws:ses:${region}:aws:reputation-policy/standard`] }),
    ],
  };
}
