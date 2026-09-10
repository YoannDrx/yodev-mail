import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  GetAccountCommand, GetConfigurationSetCommand, GetConfigurationSetEventDestinationsCommand,
  GetEmailIdentityCommand, GetTenantCommand, ListTenantResourcesCommand,
  SendEmailCommand, SESv2Client,
  type GetEmailIdentityCommandOutput, type SendEmailCommandInput, type SendEmailCommandOutput,
} from "@aws-sdk/client-sesv2";
import { isPermissionDenial, probeNames, safeError } from "./certify-ses-test.mjs";

const ACCOUNT = "764858776290";
const REGION = "eu-west-3";
const PROFILE = "yodev-mail-test";
const OPERATOR = `arn:aws:sts::${ACCOUNT}:assumed-role/AWSReservedSSO_YoDevMailAdministrator_6a8c540c90c7f6b6/`;
const SES_ARN = `arn:aws:ses:${REGION}:${ACCOUNT}`;
const options = () => ({ abortSignal: AbortSignal.timeout(20_000) });
const controlOptions = () => ({ abortSignal: AbortSignal.timeout(60_000) });
// A send has no idempotency key. Never retry an uncertain result, including at SDK level.
export const sendClientOptions = { region: REGION, maxAttempts: 1, ignoreConfiguredEndpointUrls: true } as const;
const controlClientOptions = { ...sendClientOptions, maxAttempts: 3, requestHandler: { connectionTimeout: 5000, requestTimeout: 15_000 } };
type Environment = "dev" | "prod";
type Scenario = { id: string; allow: boolean; input: SendEmailCommandInput };

function stop(code: string): never {
  const error = new Error(code);
  error.name = code;
  throw error;
}

export function assertSendIdentity(environment: Environment, run: string, identity: GetEmailIdentityCommandOutput) {
  const names = probeNames(environment, run);
  if (identity.IdentityType !== "DOMAIN" || identity.Tags?.find(tag => tag.Key === "yodev:environment")?.Value !== environment) stop("ProbeIdentityOwnershipMismatch");
  if (identity.VerifiedForSendingStatus !== true || identity.DkimAttributes?.Status !== "SUCCESS" || identity.DkimAttributes.SigningEnabled !== true) stop("ProbeIdentityNotReady");
  if (identity.MailFromAttributes?.MailFromDomain !== `bounce.${names.domain}` || identity.MailFromAttributes.MailFromDomainStatus !== "SUCCESS" || identity.MailFromAttributes.BehaviorOnMxFailure !== "REJECT_MESSAGE") stop("ProbeMailFromNotReady");
}

export function sendScenarios(environment: Environment, run: string, explicitIdentity = false): Scenario[] {
  const own = probeNames(environment, run);
  const cross = probeNames(environment === "dev" ? "prod" : "dev", run);
  // Not configurable from the CLI or environment: no real mailbox can be targeted.
  const input: SendEmailCommandInput = {
    FromEmailAddress: `probe@${own.domain}`,
    Destination: { ToAddresses: ["success@simulator.amazonses.com"] },
    TenantName: own.tenant,
    ConfigurationSetName: own.configuration,
    Content: { Simple: {
      Subject: { Data: "YoDevMail isolated IAM certification", Charset: "UTF-8" },
      Body: { Text: { Data: "Synthetic SES permission probe. No customer data.", Charset: "UTF-8" } },
    } },
  };
  const scenarios: Scenario[] = [
    { id: "send-owned", allow: true, input },
    { id: "send-no-tenant", allow: false, input: { ...input, TenantName: undefined } },
    { id: "send-cross-tenant", allow: false, input: { ...input, TenantName: cross.tenant } },
    { id: "send-cross-configuration", allow: false, input: { ...input, ConfigurationSetName: cross.configuration } },
    { id: "send-cross-identity", allow: false, input: { ...input, FromEmailAddress: `probe@${cross.domain}` } },
    { id: "send-cross-all", allow: false, input: { ...input, FromEmailAddress: `probe@${cross.domain}`, TenantName: cross.tenant, ConfigurationSetName: cross.configuration } },
  ];
  return scenarios.map(scenario => explicitIdentity ? { ...scenario, input: {
    ...scenario.input, FromEmailAddressIdentityArn: `${SES_ARN}:identity/${scenario.input.FromEmailAddress!.split("@")[1]}`,
  } } : scenario);
}

export async function executeSendScenario(scenario: Scenario, execute: () => Promise<SendEmailCommandOutput>) {
  try {
    const response = await execute();
    const accepted = response.$metadata.httpStatusCode === 200 && Boolean(response.MessageId);
    return {
      passed: scenario.allow && accepted,
      stop: !scenario.allow || !accepted,
      result: accepted ? "accepted" : "unknown",
      status: response.$metadata.httpStatusCode,
      requestId: response.$metadata.requestId,
      // Opaque provider ID is evidence of acceptance, never a claim of delivery.
      messageId: response.MessageId,
    };
  } catch (error) {
    const denial = isPermissionDenial(error);
    const details = safeError(error);
    const diagnostic = permissionDiagnostic(error, scenario.input);
    return {
      passed: !scenario.allow && denial,
      stop: !denial,
      result: denial ? (diagnostic.serviceReason === "resource-not-associated" ? "tenant-denied" : "iam-denied") : "inconclusive",
      ...details,
      ...diagnostic,
    };
  }
}

export function permissionDiagnostic(error: unknown, input: SendEmailCommandInput) {
  // Inspect only in memory. Return enumerations, never the raw AWS diagnostic,
  // which can contain a sender address or the operator's session identity.
  const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? "");
  const resource = message.match(/arn:aws:ses:[a-z0-9-]+:[0-9]+:(?:identity|configuration-set|tenant)\/[^\s'";,]+/)?.[0];
  const from = input.FromEmailAddress ?? "";
  const domain = from.split("@")[1];
  const deniedResource = resource === `${SES_ARN}:identity/${from}` ? "sender-mailbox"
    : resource === `${SES_ARN}:identity/${domain}` ? "sender-domain"
    : resource === `${SES_ARN}:configuration-set/${input.ConfigurationSetName}` ? "configuration"
    : resource?.includes(":tenant/") ? "tenant" : "other-or-unspecified";
  const denialReason = message.includes("explicit deny") ? "explicit-deny"
    : message.includes("no identity-based policy allows") ? "no-identity-allow" : "unspecified";
  const serviceReason = /not associated/i.test(message) ? "resource-not-associated" : "unspecified";
  return { deniedResource, denialReason, serviceReason };
}

async function main() {
  const [mode, run, variant, ...extra] = process.argv.slice(2);
  if (!["--send-to-simulator", "--diagnose-conditions"].includes(mode) || !run || (variant && variant !== "--explicit-identity") || extra.length) stop("UseSendToSimulatorAndYYYYMMDDaOnly");
  const diagnostic = mode === "--diagnose-conditions";
  if (diagnostic && run !== "20260910a") stop("DiagnosticResourcesArePinnedTo20260910a");
  const explicitIdentity = variant === "--explicit-identity";
  probeNames("dev", run);
  if (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"].some(key => process.env[key])) stop("UseSSOProfileNotEnvironmentCredentials");
  const operator = new STSClient({ ...controlClientOptions, profile: PROFILE });
  const inventory = new SESv2Client({ ...controlClientOptions, profile: PROFILE });
  let cases = 0;
  let failures = 0;
  let accepted = 0;
  try {
    console.log(JSON.stringify({ phase: "operator-check" }));
    const caller = await operator.send(new GetCallerIdentityCommand({}), controlOptions());
    if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(OPERATOR)) stop("TestOperatorAssertionFailed");
    console.log(JSON.stringify({ phase: "account-check" }));
    const account = await inventory.send(new GetAccountCommand({}), controlOptions());
    if (account.ProductionAccessEnabled !== false || account.SendingEnabled !== true || account.EnforcementStatus !== "HEALTHY") stop("TestSandboxStateChanged");
    // Validate both environments completely before the first SendEmail request.
    // Inventory is read-only under SSO; all sends use only candidate sender roles.
    for (const environment of ["dev", "prod"] as const) {
      const names = probeNames(environment, run);
      const identity = await inventory.send(new GetEmailIdentityCommand({ EmailIdentity: names.domain }), controlOptions());
      console.log(JSON.stringify({ phase: "preflight", environment, verified: identity.VerifiedForSendingStatus, dkim: identity.DkimAttributes?.Status, mailFrom: identity.MailFromAttributes?.MailFromDomainStatus }));
      assertSendIdentity(environment, run, identity);
      const tenant = await inventory.send(new GetTenantCommand({ TenantName: names.tenant }), controlOptions());
      if (!tenant.Tenant?.TenantArn?.startsWith(`${SES_ARN}:tenant/${names.tenant}/`)) stop("TestTenantAssertionFailed");
      const resources = await inventory.send(new ListTenantResourcesCommand({ TenantName: names.tenant, PageSize: 100 }), controlOptions());
      const expected = [`${SES_ARN}:identity/${names.domain}`, `${SES_ARN}:configuration-set/${names.configuration}`].sort();
      // Exactly two known resources: reject pagination or additional associations.
      if (resources.NextToken || JSON.stringify(resources.TenantResources?.map(resource => resource.ResourceArn).sort()) !== JSON.stringify(expected)) stop("TestTenantBindingsChanged");
      const configuration = await inventory.send(new GetConfigurationSetCommand({ ConfigurationSetName: names.configuration }), controlOptions());
      if (configuration.SendingOptions?.SendingEnabled !== true) stop("TestConfigurationSendingDisabled");
      const destinations = await inventory.send(new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: names.configuration }), controlOptions());
      if (destinations.EventDestinations?.some(destination => destination.Enabled)) stop("TestEventDestinationEnabled");
      await pause(1100);
    }
    const roles = diagnostic
      ? ["baseline", "ownership", "tenant-like", "tenant-equals"].map(variant => ({ environment: "dev" as const, role: `yodev-mail-test-ses-condition-${variant}` }))
      : (["dev", "prod"] as const).map(environment => ({ environment, role: `yodev-mail-test-ses-${environment}-sender` }));
    for (const { environment, role } of roles) {
      const session = await operator.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${ACCOUNT}:role/${role}`, RoleSessionName: `ses-send-${run}`, DurationSeconds: 900 }), controlOptions());
      const c = session.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) stop("TemporaryCredentialsUnavailable");
      const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
      const sts = new STSClient({ ...controlClientOptions, credentials });
      const sender = new SESv2Client({ ...sendClientOptions, credentials });
      try {
        const caller = await sts.send(new GetCallerIdentityCommand({}), controlOptions());
        if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/${role}/`)) stop("TestSenderAssertionFailed");
        const scenarios = sendScenarios(environment, run, explicitIdentity);
        for (const scenario of diagnostic ? scenarios.slice(0, 1) : scenarios) {
          const result = await executeSendScenario(scenario, () => sender.send(new SendEmailCommand(scenario.input), options()));
          cases += 1;
          if (!result.passed) failures += 1;
          if (result.result === "accepted") accepted += 1;
          console.log(JSON.stringify({ environment, role, case: scenario.id, ...result }));
          if (result.stop) stop("SendProbeStoppedReconcileBeforeRerun");
          await pause(1100);
        }
      } finally {
        sender.destroy();
        sts.destroy();
      }
    }
  } finally {
    inventory.destroy();
    operator.destroy();
    console.log(JSON.stringify({ account: ACCOUNT, region: REGION, run, diagnostic, explicitIdentity, cases, failures, accepted, sendingTested: cases > 0, deliveryCertified: false }));
  }
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ fatal: true, ...safeError(error) }));
    process.exitCode = 1;
  });
}
