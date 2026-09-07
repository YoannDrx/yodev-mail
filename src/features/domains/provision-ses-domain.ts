import {
  AlreadyExistsException,
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  CreateEmailIdentityCommand,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  GetEmailIdentityCommand,
  GetTenantCommand,
  PutEmailIdentityMailFromAttributesCommand,
  UpdateReputationEntityPolicyCommand,
  UpdateConfigurationSetEventDestinationCommand,
  type CreateConfigurationSetEventDestinationCommandInput,
} from "@aws-sdk/client-sesv2";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { awsClients } from "@/lib/aws";
import { env } from "@/lib/env";
import { sesResourceNames } from "@/features/providers/ses-resources";

export const SES_REPUTATION_POLICY = "standard" as const;

async function ignoreExisting(operation: () => Promise<unknown>) {
  try { await operation(); } catch (error) { if (!(error instanceof AlreadyExistsException) && (error as { name?: string }).name !== "AlreadyExistsException") throw error; }
}

export async function provisionSesDomain(input: { workspaceId: string; domain: string; existingAccountId?: string | null; signal?: AbortSignal }) {
  const signal = input.signal ?? AbortSignal.timeout(35_000);
  signal.throwIfAborted();
  const resources = sesResourceNames(input.workspaceId, process.env.DEPLOYMENT_ENVIRONMENT);
  if (!resources) throw new Error("ses_resource_configuration_invalid");
  // A legacy or cloned account requires explicit reconciliation, not a silent
  // change of tenant while other domains still reference the existing account.
  if (input.existingAccountId != null && input.existingAccountId !== resources.tenantName) {
    throw new Error("ses_account_mismatch");
  }
  const options = { abortSignal: signal };
  const { ses } = await awsClients();
  const { tenantName, configurationSetName } = resources;
  await ignoreExisting(() => ses.send(new CreateTenantCommand({ TenantName: tenantName, SuppressionAttributes: { SuppressedReasons: ["BOUNCE", "COMPLAINT"], SuppressionScope: "TENANT" } }), options));
  const tenant = await ses.send(new GetTenantCommand({ TenantName: tenantName }), options);
  if (tenant.Tenant?.TenantArn) {
    await ses.send(new UpdateReputationEntityPolicyCommand({
      ReputationEntityType: "RESOURCE",
      ReputationEntityReference: tenant.Tenant.TenantArn,
      ReputationEntityPolicy: `arn:aws:ses:${env.AWS_REGION}:aws:reputation-policy/${SES_REPUTATION_POLICY}`,
    }), options);
  }
  const configurationSets = [configurationSetName];
  for (const name of configurationSets) await ignoreExisting(() => ses.send(new CreateConfigurationSetCommand({ ConfigurationSetName: name, SendingOptions: { SendingEnabled: true }, ReputationOptions: { ReputationMetricsEnabled: true } }), options));
  await ignoreExisting(() =>
    ses.send(
      new CreateEmailIdentityCommand({
        DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
        EmailIdentity: input.domain,
      }),
      options,
    ),
  );
  const identity = await ses.send(
    new GetEmailIdentityCommand({ EmailIdentity: input.domain }),
    options,
  );
  await ses.send(new PutEmailIdentityMailFromAttributesCommand({ EmailIdentity: input.domain, MailFromDomain: `bounce.${input.domain}`, BehaviorOnMxFailure: "REJECT_MESSAGE" }), options);
  let accountId = env.AWS_ACCOUNT_ID;
  if (!accountId) accountId = (await new STSClient({ region: env.AWS_REGION }).send(new GetCallerIdentityCommand({}), options)).Account;
  if (!accountId) throw new Error("AWS account ID unavailable");
  const eventBusArn = `arn:aws:events:${env.AWS_REGION}:${accountId}:event-bus/default`;
  for (const name of configurationSets) {
    const destination: CreateConfigurationSetEventDestinationCommandInput = {
      ConfigurationSetName: name,
      EventDestinationName: "yodev-mail-eventbridge",
      EventDestination: {
        Enabled: true,
        EventBridgeDestination: { EventBusArn: eventBusArn },
        MatchingEventTypes: [
          "DELIVERY",
          "BOUNCE",
          "COMPLAINT",
          "REJECT",
          "DELIVERY_DELAY",
        ],
      },
    };
    try {
      await ses.send(new CreateConfigurationSetEventDestinationCommand(destination), options);
    } catch (error) {
      if (!(error instanceof AlreadyExistsException) && (error as { name?: string })?.name !== "AlreadyExistsException") throw error;
      // Reconcile only our named destination; do not touch unrelated destinations.
      await ses.send(new UpdateConfigurationSetEventDestinationCommand(destination), options);
    }
  }
  const identityArn = `arn:aws:ses:${env.AWS_REGION}:${accountId}:identity/${input.domain}`;
  const resourceArns = [identityArn, ...configurationSets.map(name => `arn:aws:ses:${env.AWS_REGION}:${accountId}:configuration-set/${name}`)];
  for (const arn of resourceArns) await ignoreExisting(() => ses.send(new CreateTenantResourceAssociationCommand({ TenantName: tenantName, ResourceArn: arn }), options));
  const tokens = identity.DkimAttributes?.Tokens ?? [];
  return {
    tenantName, configurationSets, tokens, identityArn,
    records: [
      ...tokens.map(token => ({ type: "CNAME", name: `${token}._domainkey.${input.domain}`, value: `${token}.dkim.amazonses.com` })),
      { type: "MX", name: `bounce.${input.domain}`, value: `10 feedback-smtp.${env.AWS_REGION}.amazonses.com` },
      { type: "TXT", name: `bounce.${input.domain}`, value: "v=spf1 include:amazonses.com -all" },
      { type: "TXT", name: `_dmarc.${input.domain}`, value: `v=DMARC1; p=none; rua=mailto:dmarc@${input.domain}` },
    ],
  };
}
