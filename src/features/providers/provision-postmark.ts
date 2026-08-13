import { randomBytes } from "node:crypto";
import { PutParameterCommand } from "@aws-sdk/client-ssm";
import { awsClients } from "@/lib/aws";
import { getSecureParameter } from "@/workers/runtime-secrets";

export type PostmarkServer = { ID: number; Name?: string; ApiTokens?: string[]; DeliveryType?: "Live" | "Sandbox" };
type PostmarkDomain = {
  ID: number;
  Name?: string;
  DKIMPendingHost?: string;
  DKIMPendingTextValue?: string;
  DKIMHost?: string;
  DKIMTextValue?: string;
  ReturnPathDomain?: string;
  ReturnPathDomainCNAMEValue?: string;
};
type PostmarkList<T> = { Servers?: T[]; Domains?: T[]; Webhooks?: Array<{ ID: number; Url?: string }> };

async function postmark<T>(path: string, accountToken: string, init: RequestInit = {}) {
  const response = await fetch(`https://api.postmarkapp.com${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Account-Token": accountToken,
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Postmark provisioning failed (${response.status}).`);
  return payload as T;
}

export function assertPostmarkServerDeliveryType(server: PostmarkServer, environment: "dev" | "prod") {
  const expected = environment === "prod" ? "Live" : "Sandbox";
  if (server.DeliveryType !== expected) {
    throw new Error(`Postmark Server ${server.ID} is ${server.DeliveryType ?? "unknown"}; ${expected} is required and DeliveryType is immutable.`);
  }
}

export async function provisionPostmarkDomain(input: {
  environment: "dev" | "prod";
  workspaceId: string;
  workspaceName: string;
  bindingId: string;
  domain: string;
  existingAccount?: { externalAccountId: string; credentialParameterName: string };
}) {
  const accountParameter = process.env.POSTMARK_ACCOUNT_TOKEN_PARAMETER ?? `/yodev-mail-${input.environment}/providers/postmark/account-token`;
  const accountToken = await getSecureParameter(accountParameter);
  const serverName = `Mail by Yodev · ${input.workspaceName} · ${input.environment.toUpperCase()}`;
  const listedServers = input.existingAccount ? [] : (await postmark<PostmarkList<PostmarkServer>>("/servers?count=500&offset=0", accountToken)).Servers ?? [];
  const priorServer = listedServers.find((item) => item.Name === serverName);
  const server = input.existingAccount
    ? { ...await postmark<PostmarkServer>(`/servers/${Number(input.existingAccount.externalAccountId)}`, accountToken), ApiTokens: [await getSecureParameter(input.existingAccount.credentialParameterName)] }
    : priorServer
      ? await postmark<PostmarkServer>(`/servers/${priorServer.ID}`, accountToken)
    : await postmark<PostmarkServer>("/servers", accountToken, {
        method: "POST",
        body: JSON.stringify({
          Name: serverName,
          Color: "Blue",
          SmtpApiActivated: false,
          RawEmailEnabled: false,
          DeliveryType: input.environment === "prod" ? "Live" : "Sandbox",
          TrackOpens: false,
          TrackLinks: "None",
        }),
      });
  assertPostmarkServerDeliveryType(server, input.environment);
  const serverToken = server.ApiTokens?.[0];
  if (!serverToken || !Number.isFinite(server.ID)) throw new Error("Postmark did not return a valid Server Token.");
  const listedDomains = (await postmark<PostmarkList<PostmarkDomain>>("/domains?count=500&offset=0", accountToken)).Domains ?? [];
  const priorDomain = listedDomains.find((item) => item.Name?.toLowerCase() === input.domain.toLowerCase());
  const domain = priorDomain
    ? await postmark<PostmarkDomain>(`/domains/${priorDomain.ID}`, accountToken)
    : await postmark<PostmarkDomain>("/domains", accountToken, {
        method: "POST",
        body: JSON.stringify({ Name: input.domain, ReturnPathDomain: `pm-bounces.${input.domain}` }),
      });
  const credentialPrefix = `/yodev-mail-${input.environment}/providers/postmark/workspaces/${input.workspaceId}`;
  const webhookParameterName = `${credentialPrefix}/webhook-password`;
  const webhookPassword = input.existingAccount
    ? await getSecureParameter(webhookParameterName)
    : randomBytes(32).toString("base64url");
  const { ssm } = await awsClients();
  const keyId = process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN;
  await Promise.all([
    input.existingAccount ? Promise.resolve() : ssm.send(new PutParameterCommand({ KeyId: keyId, Name: `${credentialPrefix}/server-token`, Type: "SecureString", Value: serverToken, Overwrite: true })),
    input.existingAccount ? Promise.resolve() : ssm.send(new PutParameterCommand({ KeyId: keyId, Name: webhookParameterName, Type: "SecureString", Value: webhookPassword, Overwrite: true })),
  ]);
  const webhookBaseUrl = process.env.POSTMARK_WEBHOOK_BASE_URL?.replace(/\/$/, "");
  if (!webhookBaseUrl) {
    throw new Error("POSTMARK_WEBHOOK_BASE_URL is required before provisioning Postmark.");
  }
  const webhookUrl = `${webhookBaseUrl}/api/providers/postmark/${input.bindingId}`;
  const existingWebhooks = await fetch("https://api.postmarkapp.com/webhooks?MessageStream=outbound", {
    headers: { Accept: "application/json", "X-Postmark-Server-Token": serverToken },
    signal: AbortSignal.timeout(15_000),
  }).then(async (response) => response.ok ? await response.json() as PostmarkList<never> : { Webhooks: [] });
  const webhookExists = existingWebhooks.Webhooks?.some((item) => item.Url === webhookUrl);
  const response = webhookExists ? null : await fetch("https://api.postmarkapp.com/webhooks", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Postmark-Server-Token": serverToken },
    body: JSON.stringify({
      Url: webhookUrl,
      MessageStream: "outbound",
      HttpAuth: { Username: "yodev-mail", Password: webhookPassword },
      Triggers: {
        Open: { Enabled: false, PostFirstOpenOnly: true },
        Click: { Enabled: false },
        Delivery: { Enabled: true },
        Bounce: { Enabled: true, IncludeContent: false },
        SpamComplaint: { Enabled: true, IncludeContent: false },
        SubscriptionChange: { Enabled: false },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response && !response.ok) throw new Error(`Postmark webhook provisioning failed (${response.status}).`);
  const dkimName = domain.DKIMPendingHost ?? domain.DKIMHost;
  const dkimValue = domain.DKIMPendingTextValue ?? domain.DKIMTextValue;
  return {
    externalAccountId: String(server.ID),
    externalDomainId: String(domain.ID),
    credentialParameterName: input.existingAccount?.credentialParameterName ?? `${credentialPrefix}/server-token`,
    records: [
      ...(dkimName && dkimValue ? [{ type: "TXT", name: dkimName, value: dkimValue }] : []),
      ...(domain.ReturnPathDomain && domain.ReturnPathDomainCNAMEValue ? [{ type: "CNAME", name: domain.ReturnPathDomain, value: domain.ReturnPathDomainCNAMEValue }] : []),
      { type: "TXT", name: `_dmarc.${input.domain}`, value: "v=DMARC1; p=none; rua=mailto:dmarc@yodev.fr; adkim=r; aspf=r; pct=100" },
    ],
  };
}
