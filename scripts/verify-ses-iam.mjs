// Read-only IAM certification. Never creates resources, assumes worker roles,
// sends email, or reads credentials/identity policies. Tags are simulated inputs.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  source: { type: "string" }, profile: { type: "string" },
  account: { type: "string" }, region: { type: "string" },
} });
if (!["assembly", "deployed"].includes(values.source) || !values.profile
  || !/^\d{12}$/.test(values.account ?? "") || !/^[a-z]{2}-[a-z]+-\d$/.test(values.region ?? "")) {
  throw new Error("Use --source assembly|deployed --profile NAME --account 12_DIGITS --region REGION");
}
const { source, profile, account, region } = values;
function aws(service, operation, input) {
  try {
    return JSON.parse(execFileSync("aws", [service, operation, "--cli-input-json", JSON.stringify(input),
      "--profile", profile, "--region", region, "--output", "json", "--no-cli-pager"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  } catch {
    throw new Error(`Read-only AWS check failed: ${service} ${operation}`);
  }
}
if (aws("sts", "get-caller-identity", {}).Account !== account) throw new Error("AWS account mismatch");
const workspaceId = "00000000-0000-4000-8000-000000000001";
const tagKey = "yodev:environment";
const identity = `arn:aws:ses:${region}:${account}:identity/certification.example.test`;
const otherRegion = region === "us-east-1" ? "eu-west-3" : "us-east-1";
let passed = 0;
const failures = [];
for (const environment of ["dev", "prod"]) {
  const other = environment === "dev" ? "prod" : "dev";
  const tenantName = `ym-${environment}-${workspaceId}`;
  const otherTenantName = `ym-${other}-${workspaceId}`;
  const prefix = `arn:aws:ses:${region}:${account}`;
  const tenant = `${prefix}:tenant/${tenantName}/tn-synthetic`;
  const otherTenant = `${prefix}:tenant/${otherTenantName}/tn-synthetic`;
  const configuration = `${prefix}:configuration-set/${tenantName}-txn`;
  const otherConfiguration = `${prefix}:configuration-set/${otherTenantName}-txn`;
  const standard = `arn:aws:ses:${region}:aws:reputation-policy/standard`;
  const owned = { [`aws:ResourceTag/${tagKey}`]: environment };
  const foreign = { [`aws:ResourceTag/${tagKey}`]: other };
  const senderContext = { ...owned, "ses:TenantName": tenantName };
  const requested = { [`aws:RequestTag/${tagKey}`]: environment, "aws:TagKeys": [tagKey] };
  const sources = {};
  for (const [worker, construct] of [["sendemail", "SendEmail"], ["providerprovisioning", "ProviderProvisioning"]]) {
    if (source === "deployed") {
      const role = aws("lambda", "get-function-configuration", { FunctionName: `yodev-mail-${environment}-${worker}` }).Role;
      if (!role?.startsWith(`arn:aws:iam::${account}:role/`)) throw new Error("Unexpected worker role");
      sources[worker] = { PolicySourceArn: role };
    } else {
      const template = JSON.parse(readFileSync(`cdk.out/YodevMail${environment === "dev" ? "Dev" : "Prod"}.template.json`, "utf8"));
      const policy = Object.values(template.Resources).find(resource => resource.Type === "AWS::IAM::Policy"
        && JSON.stringify(resource.Properties.Roles).includes(`${construct}ServiceRole`));
      if (!policy) throw new Error("Worker policy not found in assembly");
      const Statement = policy.Properties.PolicyDocument.Statement.filter(statement => [statement.Action].flat().some(action => action.startsWith("ses:")));
      const document = JSON.stringify({ Version: "2012-10-17", Statement });
      const findings = aws("accessanalyzer", "validate-policy", { policyDocument: document, policyType: "IDENTITY_POLICY" }).findings ?? [];
      if (findings.length) {
        console.log(JSON.stringify({ environment, worker, findings: findings.map(f => ({ type: f.findingType, code: f.issueCode })) }));
        throw new Error("Review policy validation findings before deployment");
      }
      sources[worker] = { PolicyInputList: [document] };
    }
  }
  function check(label, worker, action, resources, context, allowed) {
    const ContextEntries = Object.entries(context).map(([ContextKeyName, value]) => ({
      ContextKeyName, ContextKeyValues: [value].flat(), ContextKeyType: Array.isArray(value) ? "stringList" : "string",
    }));
    const response = aws("iam", source === "deployed" ? "simulate-principal-policy" : "simulate-custom-policy", {
      ...sources[worker], ActionNames: [`ses:${action}`], ResourceArns: [resources].flat(), ContextEntries,
    });
    const results = response.EvaluationResults ?? [];
    if (!results.length) throw new Error("Missing IAM evaluation result");
    const decision = results.every(result => result.EvalDecision === "allowed"
      && (result.ResourceSpecificResults ?? []).every(resource => resource.EvalResourceDecision === "allowed"));
    if (decision !== allowed) {
      failures.push(`${environment}/${label}`);
      console.log(`${environment}/${label}: UNEXPECTED ${decision ? "allowed" : "denied"}; expected ${allowed ? "allowed" : "denied"}`);
      return;
    }
    passed++;
    console.log(`${environment}/${label}: ${decision ? "allowed" : "denied"} (expected)`);
  }
  const send = (label, resource, context, allowed, action = "SendEmail") => check(label, "sendemail", action, resource, context, allowed);
  send("send-owned", [identity, configuration], senderContext, true);
  send("send-other-tenant", [identity, configuration], { ...owned, "ses:TenantName": otherTenantName }, false);
  send("send-missing-tenant", identity, owned, false);
  // ResourceTag does not work on real SendEmail in this account. IAM alone
  // permits the identity when the tenant condition matches; SES must separately
  // deny non-membership. These cases are not claims of successful SES sending.
  send("send-unowned-identity-iam-only", identity, { "ses:TenantName": tenantName }, true);
  send("send-foreign-identity-iam-only", identity, { ...foreign, "ses:TenantName": tenantName }, true);
  send("send-foreign-configuration", [identity, otherConfiguration], senderContext, false);
  send("send-other-region", `arn:aws:ses:${otherRegion}:${account}:identity/certification.example.test`, senderContext, false);
  send("send-other-account", `arn:aws:ses:${region}:000000000000:identity/certification.example.test`, senderContext, false);
  send("send-raw-api-denied", identity, senderContext, false, "SendRawEmail");
  send("send-bulk-denied", identity, senderContext, false, "SendBulkEmail");
  const provision = (label, action, resource, context, allowed) => check(label, "providerprovisioning", action, resource, context, allowed);
  for (const action of ["CreateTenant", "GetTenant"]) {
    provision(`${action}-owned`, action, tenant, {}, true);
    provision(`${action}-foreign`, action, otherTenant, {}, false);
  }
  for (const action of ["CreateConfigurationSet", "CreateConfigurationSetEventDestination", "UpdateConfigurationSetEventDestination"]) {
    provision(`${action}-owned`, action, configuration, {}, true);
    provision(`${action}-foreign`, action, otherConfiguration, {}, false);
  }
  provision("identity-create-tagged", "CreateEmailIdentity", identity, requested, true);
  provision("identity-create-untagged", "CreateEmailIdentity", identity, {}, false);
  provision("identity-read", "GetEmailIdentity", identity, {}, true);
  provision("identity-mailfrom-owned", "PutEmailIdentityMailFromAttributes", identity, owned, true);
  provision("identity-mailfrom-foreign", "PutEmailIdentityMailFromAttributes", identity, foreign, false);
  provision("identity-mailfrom-untagged", "PutEmailIdentityMailFromAttributes", identity, {}, false);
  provision("identity-tag-new", "TagResource", identity, requested, true);
  provision("identity-tag-own", "TagResource", identity, { ...requested, ...owned }, true);
  provision("identity-retag-foreign", "TagResource", identity, { ...requested, ...foreign }, false);
  provision("identity-tag-extra-key", "TagResource", identity, { ...requested, "aws:TagKeys": [tagKey, "extra"] }, false);
  provision("identity-untag-denied", "UntagResource", identity, owned, false);
  provision("associate-owned", "CreateTenantResourceAssociation", [tenant, configuration, identity], owned, true);
  provision("associate-foreign-tenant", "CreateTenantResourceAssociation", [otherTenant, identity], owned, false);
  provision("associate-foreign-configuration", "CreateTenantResourceAssociation", [tenant, otherConfiguration], owned, false);
  provision("associate-foreign-identity", "CreateTenantResourceAssociation", [tenant, identity], foreign, false);
  provision("reputation-standard", "UpdateReputationEntityPolicy", [tenant, standard], {}, true);
  provision("reputation-foreign-tenant", "UpdateReputationEntityPolicy", [otherTenant, standard], {}, false);
  provision("reputation-other-policy", "UpdateReputationEntityPolicy", [tenant, standard.replace("/standard", "/strict")], {}, false);
}
console.log(JSON.stringify({ source, passed, failures, scope: "IAM simulation only; SES tenant membership is not evaluated; no SES API execution or email delivery" }));
if (failures.length) process.exitCode = 1;
