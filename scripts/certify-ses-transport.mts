import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { GetAccountCommand, GetConfigurationSetEventDestinationsCommand, GetEmailIdentityCommand, ListTenantResourcesCommand, SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { assertSendIdentity, sendClientOptions, sendScenarios } from "./certify-ses-send.mjs";
import { probeNames, safeError } from "./certify-ses-test.mjs";
import { eventOpaqueId, eventTimestamp, eventWorkspaceId } from "../src/features/providers/event-contract";

const ACCOUNT = "764858776290";
const REGION = "eu-west-3";
const PROFILE = "yodev-mail-test";
const RUN = "20260910a";
const PREFIX = "yodev-mail-test-ses-transport";
const DESTINATION = "yodev-mail-transport-probe";
const OPERATOR = `arn:aws:sts::${ACCOUNT}:assumed-role/AWSReservedSSO_YoDevMailAdministrator_6a8c540c90c7f6b6/`;
const config = { ...sendClientOptions, profile: PROFILE, requestHandler: { connectionTimeout: 5000, requestTimeout: 20_000 } };
const options = () => ({ abortSignal: AbortSignal.timeout(25_000) });
const runCommand = promisify(execFile);
type Environment = "dev" | "prod";
type Receipt = { environment: Environment; workspaceId: string; messageId: string; providerMessageId: string };
const queueUrl = (environment: Environment, dlq = false) => `https://sqs.${REGION}.amazonaws.com/${ACCOUNT}/${PREFIX}-${environment}${dlq ? "-dlq" : ""}`;
function stop(code: string): never { const error = new Error(code); error.name = code; throw error; }

// An empty optional JSONPath is observed separately from consumer acceptance.
// This probe must not hide a malformed provider envelope by fixing it in flight.
const envelope = z.object({
  eventId: eventOpaqueId, eventType: z.literal("Delivery"), providerMessageId: eventOpaqueId,
  messageId: eventWorkspaceId, workspaceId: eventWorkspaceId, environment: z.enum(["dev", "prod"]),
  occurredAt: eventTimestamp, bounceType: z.enum(["", "Permanent", "Transient", "Undetermined"]).optional(),
}).strict();

export function parseTransportEvent(body: string, receipt: Receipt) {
  let value: unknown;
  try { value = JSON.parse(body); } catch { stop("TransportBodyNotJson"); }
  const parsed = envelope.safeParse(value);
  if (!parsed.success) stop("TransportEnvelopeInvalidOrNotPrivate");
  const event = parsed.data;
  if (event.environment !== receipt.environment || event.workspaceId !== receipt.workspaceId || event.messageId !== receipt.messageId || event.providerMessageId !== receipt.providerMessageId) stop("TransportCorrelationMismatch");
  return event;
}

export function transportSendInput(environment: Environment, workspaceId: string, messageId: string) {
  if (!eventWorkspaceId.safeParse(workspaceId).success || !eventWorkspaceId.safeParse(messageId).success) stop("ProbeIdsInvalid");
  if (environment !== "dev" && environment !== "prod") stop("ProbeEnvironmentInvalid");
  return { ...sendScenarios(environment, RUN)[0].input, EmailTags: [
    { Name: "ym_workspace_id", Value: workspaceId }, { Name: "ym_message_id", Value: messageId }, { Name: "ym_environment", Value: environment },
  ] };
}

async function cli(args: string[]) {
  try {
    const r = await runCommand("aws", [...args, "--profile", PROFILE, "--region", REGION, "--output", "json"], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    return JSON.parse(r.stdout);
  } catch { stop("TransportInventoryFailed"); }
}

async function preflight(operator: STSClient, ses: SESv2Client, sqs: SQSClient, requireEmpty: boolean) {
  const caller = await operator.send(new GetCallerIdentityCommand({}), options());
  if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(OPERATOR)) stop("DedicatedTestOperatorRequired");
  const account = await ses.send(new GetAccountCommand({}), options());
  if (account.ProductionAccessEnabled !== false || account.SendingEnabled !== true || account.EnforcementStatus !== "HEALTHY") stop("TestSandboxStateChanged");
  for (const environment of ["dev", "prod"] as const) {
    const names = probeNames(environment, RUN);
    assertSendIdentity(environment, RUN, await ses.send(new GetEmailIdentityCommand({ EmailIdentity: names.domain }), options()));
    const resources = await ses.send(new ListTenantResourcesCommand({ TenantName: names.tenant, PageSize: 100 }), options());
    const expected = [`arn:aws:ses:${REGION}:${ACCOUNT}:identity/${names.domain}`, `arn:aws:ses:${REGION}:${ACCOUNT}:configuration-set/${names.configuration}`].sort();
    if (resources.NextToken || JSON.stringify(resources.TenantResources?.map(r => r.ResourceArn).sort()) !== JSON.stringify(expected)) stop("TestTenantBindingsChanged");
    const destinations = await ses.send(new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: names.configuration }), options());
    const active = destinations.EventDestinations?.filter(d => d.Enabled) ?? [];
    if (active.length !== 1 || active[0].Name !== DESTINATION || JSON.stringify(active[0].MatchingEventTypes) !== '["DELIVERY"]' || active[0].EventBridgeDestination?.EventBusArn !== `arn:aws:events:${REGION}:${ACCOUNT}:event-bus/default`) stop("TransportDestinationMismatch");
    const rule = await cli(["events", "describe-rule", "--name", `${PREFIX}-${environment}`]);
    const pattern = JSON.parse(rule.EventPattern);
    if (rule.State !== "ENABLED" || JSON.stringify(pattern.source) !== '["aws.ses"]' || JSON.stringify(pattern.account) !== JSON.stringify([ACCOUNT]) || JSON.stringify(pattern.region) !== JSON.stringify([REGION]) || JSON.stringify(pattern.detail?.mail?.tags?.ym_environment) !== JSON.stringify([environment]) || JSON.stringify(pattern.detail?.mail?.tags?.["ses:configuration-set"]) !== JSON.stringify([names.configuration])) stop("TransportRuleMismatch");
    const targets = await cli(["events", "list-targets-by-rule", "--rule", `${PREFIX}-${environment}`]);
    const target = targets.Targets?.[0];
    if (targets.NextToken || targets.Targets?.length !== 1 || target.Arn !== `arn:aws:sqs:${REGION}:${ACCOUNT}:${PREFIX}-${environment}` || !target.InputTransformer || target.DeadLetterConfig || target.Input || target.InputPath) stop("TransportTargetMismatch");
    const allowedPaths = ["$.id", "$.detail.eventType", "$.detail.mail.messageId", "$.detail.mail.tags.ym_message_id[0]", "$.detail.mail.tags.ym_workspace_id[0]", "$.detail.mail.tags.ym_environment[0]", "$.time", "$.detail.bounce.bounceType"].sort();
    if (JSON.stringify(Object.values(target.InputTransformer.InputPathsMap).sort()) !== JSON.stringify(allowedPaths)) stop("TransportPathsMismatch");
    const expectedTemplate = '{"eventId":<id>,"eventType":<detail-eventType>,"providerMessageId":<detail-mail-messageId>,"messageId":<detail-mail-tags-ym_message_id-0->,"workspaceId":<detail-mail-tags-ym_workspace_id-0->,"environment":<detail-mail-tags-ym_environment-0->,"occurredAt":<time>,"bounceType":<detail-bounce-bounceType>}';
    if (target.InputTransformer.InputTemplate !== expectedTemplate) stop("TransportInputTemplateMismatch");
    for (const dlq of [false, true]) {
      const a = (await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(environment, dlq), AttributeNames: ["QueueArn", "KmsMasterKeyId", "ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"] }), options())).Attributes;
      if (!a?.KmsMasterKeyId || a.QueueArn !== `arn:aws:sqs:${REGION}:${ACCOUNT}:${PREFIX}-${environment}${dlq ? "-dlq" : ""}`) stop("TransportQueueMismatch");
      if (requireEmpty && [a.ApproximateNumberOfMessages, a.ApproximateNumberOfMessagesNotVisible, a.ApproximateNumberOfMessagesDelayed].some(v => v !== "0")) stop("TransportQueuesNotEmptyReconcileBeforeSend");
    }
    console.log(JSON.stringify({ phase: "preflight", environment, passed: true }));
  }
}

async function observe(sqs: SQSClient, receipt: Receipt) {
  // No invocation of a worker, DB access or runtime secret resolution here.
  const { normalizeSanitizedSesEvent } = await import("../src/workers/ses-events");
  const originalEnvironment = process.env.DEPLOYMENT_ENVIRONMENT;
  const deadline = Date.now() + 180_000;
  try {
    process.env.DEPLOYMENT_ENVIRONMENT = receipt.environment;
    while (Date.now() < deadline) {
      const response = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl(receipt.environment), MaxNumberOfMessages: 10, WaitTimeSeconds: 10, VisibilityTimeout: 60 }), options());
      if (!response.Messages?.length) { console.log(JSON.stringify({ phase: "await-event", environment: receipt.environment })); continue; }
      // Validate the whole batch before acknowledging anything.
      const checked = response.Messages.map(m => {
        if (!m.Body || !m.ReceiptHandle) stop("TransportRecordIncomplete");
        const event = parseTransportEvent(m.Body, receipt);
        const normalized = normalizeSanitizedSesEvent(event);
        console.log(JSON.stringify({ phase: "event-contract", environment: receipt.environment, eventId: event.eventId, privateEnvelope: true, bounceField: event.bounceType === undefined ? "absent" : event.bounceType === "" ? "empty" : "present", consumerAccepted: normalized !== null }));
        if (!normalized || normalized.type !== "delivered") stop("DeployedContractNotAcceptedByConsumer");
        process.env.DEPLOYMENT_ENVIRONMENT = receipt.environment === "dev" ? "prod" : "dev";
        const cross = normalizeSanitizedSesEvent(event);
        process.env.DEPLOYMENT_ENVIRONMENT = receipt.environment;
        if (cross !== null) stop("CrossEnvironmentConsumerAccepted");
        return m;
      });
      for (const m of checked) await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl(receipt.environment), ReceiptHandle: m.ReceiptHandle! }), options());
      console.log(JSON.stringify({ phase: "observed", ...receipt, acknowledged: checked.length, crossEnvironmentConsumerRejected: true }));
      return;
    }
    stop("TransportObservationTimedOutDoNotResend");
  } finally {
    if (originalEnvironment === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT;
    else process.env.DEPLOYMENT_ENVIRONMENT = originalEnvironment;
  }
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!["--preflight", "--send-two", "--send-prod", "--observe"].includes(mode) || (mode !== "--observe" && args.length) || (mode === "--observe" && args.length !== 4)) stop("UsePreflightSendTwoSendProdOrObserveReceipt");
  if (["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "RUNTIME_PARAMETER_PREFIX"].some(k => process.env[k])) stop("UseCleanSSOEnvironmentWithoutDatabaseOrRuntimeSecrets");
  const operator = new STSClient(config);
  const inventory = new SESv2Client(config);
  const sqs = new SQSClient(config);
  let accepted = 0;
  try {
    await preflight(operator, inventory, sqs, mode !== "--observe");
    if (mode === "--preflight") return;
    if (mode === "--observe") {
      const [environment, workspaceId, messageId, providerMessageId] = args;
      transportSendInput(environment as Environment, workspaceId, messageId);
      if (!eventOpaqueId.safeParse(providerMessageId).success) stop("ProbeProviderIdInvalid");
      await observe(sqs, { environment: environment as Environment, workspaceId, messageId, providerMessageId });
      return;
    }
    // Resume the never-sent second case without repeating the accepted dev send.
    for (const environment of mode === "--send-prod" ? ["prod"] as const : ["dev", "prod"] as const) {
      const role = `yodev-mail-test-ses-${environment}-sender`;
      const session = await operator.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${ACCOUNT}:role/${role}`, RoleSessionName: "ses-transport-probe", DurationSeconds: 900 }), options());
      const c = session.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) stop("TemporaryCredentialsUnavailable");
      const credentials = { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
      const sender = new SESv2Client({ ...sendClientOptions, credentials });
      const sts = new STSClient({ ...config, credentials });
      try {
        const caller = await sts.send(new GetCallerIdentityCommand({}), options());
        if (caller.Account !== ACCOUNT || !caller.Arn?.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/${role}/`)) stop("SenderRoleMismatch");
        const workspaceId = randomUUID(), messageId = randomUUID();
        const response = await sender.send(new SendEmailCommand(transportSendInput(environment, workspaceId, messageId)), options());
        if (response.$metadata.httpStatusCode !== 200 || !response.MessageId) stop("SendUnknownDoNotRetry");
        accepted++;
        const receipt = { environment, workspaceId, messageId, providerMessageId: response.MessageId };
        console.log(JSON.stringify({ phase: "accepted", ...receipt, requestId: response.$metadata.requestId }));
        await observe(sqs, receipt);
      } finally { sender.destroy(); sts.destroy(); }
    }
  } finally {
    operator.destroy(); inventory.destroy(); sqs.destroy();
    console.log(JSON.stringify({ account: ACCOUNT, region: REGION, accepted, applicationChainCertified: false, commercialSendingEnabled: false }));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  console.error(JSON.stringify({ fatal: true, ...safeError(error) })); process.exitCode = 1;
});
