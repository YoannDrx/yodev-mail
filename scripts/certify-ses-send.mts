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
// A send has no idempotency key. Never retry an uncertain result, including at SDK level.
export const sendClientOptions = { region: REGION, maxAttempts: 1, ignoreConfiguredEndpointUrls: true } as const;
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

export function sendScenarios(environment: Environment, run: string): Scenario[] {
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
  return [
    { id: "send-owned", allow: true, input },
    { id: "send-no-tenant", allow: false, input: { ...input, TenantName: undefined } },
    { id: "send-cross-tenant", allow: false, input: { ...input, TenantName: cross.tenant } },
    { id: "send-cross-configuration", allow: false, input: { ...input, ConfigurationSetName: cross.configuration } },
    { id: "send-cross-identity", allow: false, input: { ...input, FromEmailAddress: `probe@${cross.domain}` } },
    { id: "send-cross-all", allow: false, input: { ...input, FromEmailAddress: `probe@${cross.domain}`, TenantName: cross.tenant, ConfigurationSetName: cross.configuration } },
  ];
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
    return {
      passed: !scenario.allow && denial,
      stop: !denial,
      result: denial ? "iam-denied" : "inconclusive",
      ...details,
    };
  }
}

async function main() {
  const [mode, run, ...extra] = process.argv.slice(2);
  if (mode !== "--send-to-simulator" || !run || extra.length) stop("UseSendToSimulatorAndYYYYMMDDaOnly");
  probeNames("dev", run);
  if (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"].some(key => process.env[key])) stop("UseSSOProfileNotEnvironmentCredentials");
  const operator = new STSClient({ ...sendClientOptions, profile: PROFILE });
  const inventory = new SESv2Client({ ...sendClientOptions, profile: PROFILE });
  let cases = 0;
  let failures = 0;
  let accepted = 0;
  try {
    const caller = await operator.send(new GetCallerIdentityCommand({}), options());
    if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(OPERATOR)) stop("TestOperatorAssertionFailed");
    const account = await inventory.send(new GetAccountCommand({}), options());
    if (account.ProductionAccessEnabled !== false || account.SendingEnabled !== true || account.EnforcementStatus !== "HEALTHY") stop("TestSandboxStateChanged");
    // Validate both environments completely before the first SendEmail request.
    // Inventory is read-only under SSO; all sends use only candidate sender roles.
    for (const environment of ["dev", "prod"] as const) {
      const names = probeNames(environment, run);
      const identity = await inventory.send(new GetEmailIdentityCommand({ EmailIdentity: names.domain }), options());
      console.log(JSON.stringify({ phase: "preflight", environment, verified: identity.VerifiedForSendingStatus, dkim: identity.DkimAttributes?.Status, mailFrom: identity.MailFromAttributes?.MailFromDomainStatus }));
      assertSendIdentity(environment, run, identity);
      const tenant = await inventory.send(new GetTenantCommand({ TenantName: names.tenant }), options());
      if (!tenant.Tenant?.TenantArn?.startsWith(`${SES_ARN}:tenant/${names.tenant}/`)) stop("TestTenantAssertionFailed");
      const resources = await inventory.send(new ListTenantResourcesCommand({ TenantName: names.tenant, PageSize: 100 }), options());
      const expected = [`${SES_ARN}:identity/${names.domain}`, `${SES_ARN}:configuration-set/${names.configuration}`].sort();
      // Exactly two known resources: reject pagination or additional associations.
      if (resources.NextToken || JSON.stringify(resources.TenantResources?.map(resource => resource.ResourceArn).sort()) !== JSON.stringify(expected)) stop("TestTenantBindingsChanged");
      const configuration = await inventory.send(new GetConfigurationSetCommand({ ConfigurationSetName: names.configuration }), options());
      if (configuration.SendingOptions?.SendingEnabled !== true) stop("TestConfigurationSendingDisabled");
      const destinations = await inventory.send(new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: names.configuration }), options());
      if (destinations.EventDestinations?.some(destination => destination.Enabled)) stop("TestEventDestinationEnabled");
      await pause(1100);
    }
    for (const environment of ["dev", "prod"] as const) {
      const role = `yodev-mail-test-ses-${environment}-sender`;
      const session = await operator.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${ACCOUNT}:role/${role}`, RoleSessionName: `ses-send-${run}`, DurationSeconds: 900 }), options());
      const c = session.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) stop("TemporaryCredentialsUnavailable");
      const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
      const sts = new STSClient({ ...sendClientOptions, credentials });
      const sender = new SESv2Client({ ...sendClientOptions, credentials });
      try {
        const caller = await sts.send(new GetCallerIdentityCommand({}), options());
        if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/${role}/`)) stop("TestSenderAssertionFailed");
        for (const scenario of sendScenarios(environment, run)) {
          const result = await executeSendScenario(scenario, () => sender.send(new SendEmailCommand(scenario.input), options()));
          cases += 1;
          if (!result.passed) failures += 1;
          if (result.result === "accepted") accepted += 1;
          console.log(JSON.stringify({ environment, case: scenario.id, ...result }));
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
    console.log(JSON.stringify({ account: ACCOUNT, region: REGION, run, cases, failures, accepted, sendingTested: cases > 0, deliveryCertified: false }));
  }
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ fatal: true, ...safeError(error) }));
    process.exitCode = 1;
  });
}
