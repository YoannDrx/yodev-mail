import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  CreateConfigurationSetCommand, CreateEmailIdentityCommand, CreateTenantCommand,
  GetConfigurationSetCommand, GetEmailIdentityCommand, GetTenantCommand, SESv2Client,
  CreateTenantResourceAssociationCommand, PutEmailIdentityMailFromAttributesCommand,
  CreateConfigurationSetEventDestinationCommand, UpdateConfigurationSetEventDestinationCommand,
  UpdateReputationEntityPolicyCommand,
} from "@aws-sdk/client-sesv2";

const ACCOUNT = "764858776290";
const REGION = "eu-west-3";
const PROFILE = "yodev-mail-test";
const OPERATOR = `arn:aws:sts::${ACCOUNT}:assumed-role/AWSReservedSSO_YoDevMailAdministrator_6a8c540c90c7f6b6/`;
const TAG = "yodev:environment";
const options = () => ({ abortSignal: AbortSignal.timeout(20_000) });

export function probeNames(environment: "dev" | "prod", run: string) {
  if (!/^[0-9]{8}[a-z]$/.test(run)) throw new Error("Use a unique YYYYMMDDa run identifier");
  return {
    domain: `${environment}.ses-probe-${run}.yodev.fr`,
    configuration: `ym-${environment}-ses-probe-${run}-txn`,
    tenant: `ym-${environment}-ses-probe-${run}`,
  };
}

export function safeError(error: unknown) {
  const value = error as { name?: unknown; $metadata?: { httpStatusCode?: number; requestId?: string } };
  return {
    code: typeof value?.name === "string" ? value.name : "UnknownError",
    status: value?.$metadata?.httpStatusCode,
    requestId: value?.$metadata?.requestId,
  };
}

export function isPermissionDenial(error: unknown) {
  const result = safeError(error);
  return result.status === 403 && ["AccessDeniedException", "AccessDenied"].includes(result.code);
}

async function main() {
  const [mode, run, ...extra] = process.argv.slice(2);
  if (!["--provision", "--bindings"].includes(mode) || !run || extra.length) throw new Error("Usage: tsx scripts/certify-ses-test.mts --provision|--bindings YYYYMMDDa");
  probeNames("dev", run);
  if (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN"].some(key => process.env[key])) {
    throw new Error("Use the explicit SSO profile, not environment credentials");
  }
  const operator = new STSClient({ region: REGION, profile: PROFILE, maxAttempts: 1 });
  const caller = await operator.send(new GetCallerIdentityCommand({}), options());
  if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(OPERATOR)) throw new Error("Dedicated test account/operator assertion failed");
  const inventory = new SESv2Client({ region: REGION, profile: PROFILE, maxAttempts: 1 });
  // Never overwrite or silently reuse resources from a previous run. A partial
  // run needs operator reconciliation, not an automatic retry or deletion.
  for (const environment of mode === "--provision" ? ["dev", "prod"] as const : []) {
    const names = probeNames(environment, run);
    for (const check of [
      () => inventory.send(new GetConfigurationSetCommand({ ConfigurationSetName: names.configuration }), options()),
      () => inventory.send(new GetConfigurationSetCommand({ ConfigurationSetName: `${names.tenant}-denied-txn` }), options()),
      () => inventory.send(new GetTenantCommand({ TenantName: names.tenant }), options()),
      () => inventory.send(new GetTenantCommand({ TenantName: `${names.tenant}-denied` }), options()),
      ...[names.domain, `wrong-tag.${names.domain}`, `no-tag.${names.domain}`].map(EmailIdentity => () => inventory.send(new GetEmailIdentityCommand({ EmailIdentity }), options())),
    ]) {
      try {
        await check();
        throw new Error("Probe resource already exists; reconcile before another run");
      } catch (error) {
        if (safeError(error).code !== "NotFoundException") throw error;
      }
      await pause(1100);
    }
  }
  let failures = 0;
  let cases = 0;
  for (const environment of ["dev", "prod"] as const) {
    const role = `yodev-mail-test-ses-${environment}-provisioner`;
    const session = await operator.send(new AssumeRoleCommand({
      RoleArn: `arn:aws:iam::${ACCOUNT}:role/${role}`, RoleSessionName: `ses-probe-${run}`, DurationSeconds: 900,
    }), options());
    const c = session.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) throw new Error("Temporary role credentials unavailable");
    // Short-lived credentials stay in memory and never enter files or output.
    const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
    const identityClient = new STSClient({ region: REGION, credentials, maxAttempts: 1 });
    const identity = await identityClient.send(new GetCallerIdentityCommand({}), options());
    if (identity.Account !== ACCOUNT || !identity.Arn?.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/${role}/`)) throw new Error("Probe role assertion failed");
    const client = new SESv2Client({ region: REGION, credentials, maxAttempts: 1 });
    const names = probeNames(environment, run);
    const opposite = environment === "dev" ? "prod" : "dev";
    const cross = probeNames(opposite, run);
    const arn = `arn:aws:ses:${REGION}:${ACCOUNT}`;
    let tenantArn: string | undefined;
    if (mode === "--bindings") {
      // Only continue against the exact resources explicitly created for this
      // run; do not adopt an arbitrary identity or another environment's tags.
      const existing = await inventory.send(new GetEmailIdentityCommand({ EmailIdentity: names.domain }), options());
      if (existing.Tags?.find(tag => tag.Key === TAG)?.Value !== environment) throw new Error("Test identity ownership mismatch");
      const tenant = await client.send(new GetTenantCommand({ TenantName: names.tenant }), options());
      tenantArn = tenant.Tenant?.TenantArn;
      if (!tenantArn?.startsWith(`${arn}:tenant/${names.tenant}/`)) throw new Error("Test tenant ARN mismatch");
    }
    const destination = {
      EventDestinationName: "yodev-mail-probe",
      EventDestination: { Enabled: false, MatchingEventTypes: ["DELIVERY" as const], EventBridgeDestination: { EventBusArn: `arn:aws:events:${REGION}:${ACCOUNT}:event-bus/default` } },
    };
    const casesToRun = mode === "--provision" ? [
      { id: "create-configuration-owned", allow: true, execute: () => client.send(new CreateConfigurationSetCommand({ ConfigurationSetName: names.configuration, SendingOptions: { SendingEnabled: true }, ReputationOptions: { ReputationMetricsEnabled: true } }), options()) },
      { id: "create-configuration-cross", allow: false, execute: () => client.send(new CreateConfigurationSetCommand({ ConfigurationSetName: `${cross.tenant}-denied-txn` }), options()) },
      { id: "create-identity-owned", allow: true, execute: () => client.send(new CreateEmailIdentityCommand({ EmailIdentity: names.domain, DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" }, Tags: [{ Key: TAG, Value: environment }] }), options()) },
      { id: "create-identity-cross-tag", allow: false, execute: () => client.send(new CreateEmailIdentityCommand({ EmailIdentity: `wrong-tag.${names.domain}`, Tags: [{ Key: TAG, Value: opposite }] }), options()) },
      { id: "create-identity-no-tag", allow: false, execute: () => client.send(new CreateEmailIdentityCommand({ EmailIdentity: `no-tag.${names.domain}` }), options()) },
      { id: "create-tenant-owned", allow: true, execute: () => client.send(new CreateTenantCommand({ TenantName: names.tenant, SuppressionAttributes: { SuppressedReasons: ["BOUNCE", "COMPLAINT"], SuppressionScope: "TENANT" } }), options()) },
      { id: "create-tenant-cross", allow: false, execute: () => client.send(new CreateTenantCommand({ TenantName: `${cross.tenant}-denied` }), options()) },
    ] : [
      { id: "get-identity-owned", allow: true, execute: () => client.send(new GetEmailIdentityCommand({ EmailIdentity: names.domain }), options()) },
      { id: "get-tenant-owned", allow: true, execute: () => client.send(new GetTenantCommand({ TenantName: names.tenant }), options()) },
      { id: "get-tenant-cross", allow: false, execute: () => client.send(new GetTenantCommand({ TenantName: cross.tenant }), options()) },
      { id: "mail-from-owned", allow: true, execute: () => client.send(new PutEmailIdentityMailFromAttributesCommand({ EmailIdentity: names.domain, MailFromDomain: `bounce.${names.domain}`, BehaviorOnMxFailure: "REJECT_MESSAGE" }), options()) },
      { id: "mail-from-cross", allow: false, execute: () => client.send(new PutEmailIdentityMailFromAttributesCommand({ EmailIdentity: cross.domain, MailFromDomain: `bounce.${cross.domain}`, BehaviorOnMxFailure: "REJECT_MESSAGE" }), options()) },
      { id: "associate-identity-owned", allow: true, execute: () => client.send(new CreateTenantResourceAssociationCommand({ TenantName: names.tenant, ResourceArn: `${arn}:identity/${names.domain}` }), options()) },
      { id: "associate-identity-cross", allow: false, execute: () => client.send(new CreateTenantResourceAssociationCommand({ TenantName: names.tenant, ResourceArn: `${arn}:identity/${cross.domain}` }), options()) },
      { id: "associate-tenant-cross", allow: false, execute: () => client.send(new CreateTenantResourceAssociationCommand({ TenantName: cross.tenant, ResourceArn: `${arn}:identity/${names.domain}` }), options()) },
      { id: "associate-configuration-owned", allow: true, execute: () => client.send(new CreateTenantResourceAssociationCommand({ TenantName: names.tenant, ResourceArn: `${arn}:configuration-set/${names.configuration}` }), options()) },
      { id: "associate-configuration-cross", allow: false, execute: () => client.send(new CreateTenantResourceAssociationCommand({ TenantName: names.tenant, ResourceArn: `${arn}:configuration-set/${cross.configuration}` }), options()) },
      { id: "create-event-destination-owned", allow: true, execute: () => client.send(new CreateConfigurationSetEventDestinationCommand({ ...destination, ConfigurationSetName: names.configuration }), options()) },
      { id: "create-event-destination-cross", allow: false, execute: () => client.send(new CreateConfigurationSetEventDestinationCommand({ ...destination, EventDestinationName: "yodev-mail-probe-denied", ConfigurationSetName: cross.configuration }), options()) },
      { id: "update-event-destination-owned", allow: true, execute: () => client.send(new UpdateConfigurationSetEventDestinationCommand({ ...destination, ConfigurationSetName: names.configuration }), options()) },
      { id: "update-event-destination-cross", allow: false, execute: () => client.send(new UpdateConfigurationSetEventDestinationCommand({ ...destination, ConfigurationSetName: cross.configuration }), options()) },
      { id: "reputation-standard-owned", allow: true, execute: () => client.send(new UpdateReputationEntityPolicyCommand({ ReputationEntityType: "RESOURCE", ReputationEntityReference: tenantArn, ReputationEntityPolicy: `arn:aws:ses:${REGION}:aws:reputation-policy/standard` }), options()) },
    ];
    for (const scenario of casesToRun) {
      cases += 1;
      try {
        const response = await scenario.execute();
        const passed = scenario.allow && response.$metadata.httpStatusCode === 200;
        if (!passed) failures += 1;
        console.log(JSON.stringify({ environment, case: scenario.id, passed, result: "accepted", status: response.$metadata.httpStatusCode, requestId: response.$metadata.requestId }));
        // An unexpected authorization is a hard stop, not a reason to keep writing.
        if (!scenario.allow) throw new Error("Unexpected authorization; inspect the synthetic test resource");
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("Unexpected authorization")) throw error;
        const passed = !scenario.allow && isPermissionDenial(error);
        if (!passed) failures += 1;
        console.log(JSON.stringify({ environment, case: scenario.id, passed, result: "rejected", ...safeError(error) }));
      }
      await pause(1100);
    }
    client.destroy();
    identityClient.destroy();
  }
  inventory.destroy();
  operator.destroy();
  console.log(JSON.stringify({ account: ACCOUNT, region: REGION, run, mode, cases, failures, sendingTested: false, deliveryCertified: false }));
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // No response objects, caller session names, addresses or secrets in logs.
    console.error(JSON.stringify({ fatal: true, ...safeError(error) }));
    process.exitCode = 1;
  });
}
