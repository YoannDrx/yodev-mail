import {
  AlreadyExistsException,
  CreateConfigurationSetCommand,
  CreateConfigurationSetEventDestinationCommand,
  CreateEmailIdentityCommand,
  CreateTenantCommand,
  CreateTenantResourceAssociationCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
} from "@aws-sdk/client-sesv2";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { awsClients } from "@/lib/aws";
import { env } from "@/lib/env";

function safeName(value: string) { return value.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 55); }
async function ignoreExisting(operation: () => Promise<unknown>) {
  try { await operation(); } catch (error) { if (!(error instanceof AlreadyExistsException) && (error as { name?: string }).name !== "AlreadyExistsException") throw error; }
}

export async function provisionSesDomain(input: { workspaceId: string; domain: string }) {
  const { ses } = await awsClients();
  const tenantName = safeName(`vm-${input.workspaceId}`);
  await ignoreExisting(() => ses.send(new CreateTenantCommand({ TenantName: tenantName, SuppressionAttributes: { SuppressedReasons: ["BOUNCE", "COMPLAINT"], SuppressionScope: "TENANT" } })));
  const configurationSets = [`${tenantName}-txn`, `${tenantName}-mkt-private`, `${tenantName}-mkt-tracked`];
  for (const name of configurationSets) await ignoreExisting(() => ses.send(new CreateConfigurationSetCommand({ ConfigurationSetName: name, SendingOptions: { SendingEnabled: true }, ReputationOptions: { ReputationMetricsEnabled: true } })));
  await ignoreExisting(() =>
    ses.send(
      new CreateEmailIdentityCommand({
        DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" },
        EmailIdentity: input.domain,
      }),
    ),
  );
  const identity = await ses.send(
    new GetEmailIdentityCommand({ EmailIdentity: input.domain }),
  );
  await ses.send(new PutEmailIdentityMailFromAttributesCommand({ EmailIdentity: input.domain, MailFromDomain: `bounce.${input.domain}`, BehaviorOnMxFailure: "REJECT_MESSAGE" }));
  let accountId = env.AWS_ACCOUNT_ID;
  if (!accountId) accountId = (await new STSClient({ region: env.AWS_REGION }).send(new GetCallerIdentityCommand({}))).Account;
  if (!accountId) throw new Error("AWS account ID unavailable");
  const eventBusArn = `arn:aws:events:${env.AWS_REGION}:${accountId}:event-bus/default`;
  for (const name of configurationSets) {
    await ignoreExisting(() =>
      ses.send(
        new CreateConfigurationSetEventDestinationCommand({
          ConfigurationSetName: name,
          EventDestinationName: "vigiemail-eventbridge",
          EventDestination: {
            Enabled: true,
            EventBridgeDestination: { EventBusArn: eventBusArn },
            MatchingEventTypes: [
              "SEND",
              "DELIVERY",
              "BOUNCE",
              "COMPLAINT",
              "REJECT",
              "DELIVERY_DELAY",
            ],
          },
        }),
      ),
    );
  }
  const resources = [`arn:aws:ses:${env.AWS_REGION}:${accountId}:identity/${input.domain}`, ...configurationSets.map(name => `arn:aws:ses:${env.AWS_REGION}:${accountId}:configuration-set/${name}`)];
  for (const arn of resources) await ignoreExisting(() => ses.send(new CreateTenantResourceAssociationCommand({ TenantName: tenantName, ResourceArn: arn })));
  const tokens = identity.DkimAttributes?.Tokens ?? [];
  return {
    tenantName, configurationSets, tokens,
    records: [
      ...tokens.map(token => ({ type: "CNAME", name: `${token}._domainkey.${input.domain}`, value: `${token}.dkim.amazonses.com` })),
      { type: "MX", name: `bounce.${input.domain}`, value: `10 feedback-smtp.${env.AWS_REGION}.amazonses.com` },
      { type: "TXT", name: `bounce.${input.domain}`, value: "v=spf1 include:amazonses.com -all" },
      { type: "TXT", name: `_dmarc.${input.domain}`, value: `v=DMARC1; p=none; rua=mailto:dmarc@${input.domain}` },
    ],
  };
}
