import { randomBytes } from "node:crypto";
import { PutParameterCommand } from "@aws-sdk/client-ssm";
import { awsClients } from "@/lib/aws";
import { getSecureParameter } from "@/workers/runtime-secrets";
import { parseProvisioningJob } from "./provisioning-job";

export type PostmarkServer = { ID: number; Name?: string; ApiTokens?: string[]; DeliveryType?: "Live" | "Sandbox" };
type PostmarkDomain = {
  ID: number; Name?: string; DKIMPendingHost?: string; DKIMPendingTextValue?: string;
  DKIMHost?: string; DKIMTextValue?: string; ReturnPathDomain?: string; ReturnPathDomainCNAMEValue?: string;
};
type PostmarkWebhook = { ID: number; Url?: string; Status?: string };
export type PostmarkAccountCheckpoint = { externalAccountId?: string; credentialParameterName?: string };
export const POSTMARK_WEBHOOK_CREATE_UNCERTAIN = "postmark_webhook_creation_requires_reconciliation";

function validId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function client(token: string, scope: "Account" | "Server", signal: AbortSignal) {
  return async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    signal.throwIfAborted();
    const response = await fetch(`https://api.postmarkapp.com${path}`, {
      ...init,
      redirect: "error",
      headers: { Accept: "application/json", "Content-Type": "application/json", [`X-Postmark-${scope}-Token`]: token },
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("postmark_provisioning_request_failed");
    }
    const payload: unknown = await response.json().catch(() => { throw new Error("postmark_provisioning_response_invalid"); });
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("postmark_provisioning_response_invalid");
    return payload as T;
  };
}

async function findUnique<T extends { ID: number; Name?: string }>(
  request: ReturnType<typeof client>, resource: "servers" | "domains", name: string,
) {
  const key = resource === "servers" ? "Servers" : "Domains";
  const matches: T[] = [];
  const seen = new Set<number>();
  let offset = 0;
  for (;;) {
    const filter = resource === "servers" ? `&name=${encodeURIComponent(name)}` : "";
    const page = await request<{ TotalCount: number } & Partial<Record<typeof key, T[]>>>(`/${resource}?count=500&offset=${offset}${filter}`);
    const rows = page[key];
    if (!Array.isArray(rows) || !Number.isSafeInteger(page.TotalCount) || page.TotalCount < 0
      || rows.length > 500 || (!rows.length && offset < page.TotalCount)) throw new Error("postmark_provisioning_list_invalid");
    for (const row of rows) {
      if (!row || !validId(row.ID) || typeof row.Name !== "string" || seen.has(row.ID)) throw new Error("postmark_provisioning_list_invalid");
      seen.add(row.ID);
      if (row.Name.toLowerCase() === name.toLowerCase()) matches.push(row);
    }
    if (matches.length > 1) throw new Error("postmark_provisioning_identity_ambiguous");
    offset += rows.length;
    if (offset >= page.TotalCount) return matches[0];
  }
}

// A retry must reuse credentials, never rotate one side of a webhook implicitly.
async function createCredentialOnce(name: string, value: string, keyId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const { ssm } = await awsClients();
  try {
    await ssm.send(new PutParameterCommand({ KeyId: keyId, Name: name, Type: "SecureString", Value: value, Overwrite: false }), { abortSignal: signal });
    return value;
  } catch (error) {
    if ((error as { name?: string })?.name !== "ParameterAlreadyExists") throw new Error("postmark_credential_creation_failed");
    return getSecureParameter(name, signal);
  }
}

export function assertPostmarkServerDeliveryType(server: PostmarkServer, environment: "dev" | "prod") {
  const expected = environment === "prod" ? "Live" : "Sandbox";
  if (server.DeliveryType !== expected) throw new Error(`Postmark Server delivery type must be ${expected}; DeliveryType is immutable.`);
}

export function normalizePostmarkWebhookBaseUrl(value: string | undefined) {
  if (!value) throw new Error("POSTMARK_WEBHOOK_BASE_URL is required before provisioning Postmark.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("POSTMARK_WEBHOOK_BASE_URL must be a valid HTTPS origin."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("POSTMARK_WEBHOOK_BASE_URL must be a valid HTTPS origin.");
  }
  return url.origin;
}

export async function provisionPostmarkDomain(input: {
  environment: "dev" | "prod"; workspaceId: string; workspaceName: string; bindingId: string; domain: string;
  existingAccount?: { externalAccountId: string | null; credentialParameterName: string | null };
  checkpoint: (state: PostmarkAccountCheckpoint) => Promise<void>;
  beforeWebhookCreate: () => Promise<void>;
  webhookCreationAttempted?: boolean;
  signal?: AbortSignal;
}) {
  const webhookBaseUrl = normalizePostmarkWebhookBaseUrl(process.env.POSTMARK_WEBHOOK_BASE_URL);
  const keyId = process.env.PROVIDER_CREDENTIALS_KMS_KEY_ARN;
  if (!input.existingAccount?.credentialParameterName && !keyId) throw new Error("PROVIDER_CREDENTIALS_KMS_KEY_ARN is required before provisioning Postmark.");
  parseProvisioningJob({ workspaceId: input.workspaceId, bindingId: input.bindingId });
  const signal = input.signal ?? AbortSignal.timeout(35_000);
  signal.throwIfAborted();
  const accountParameter = process.env.POSTMARK_ACCOUNT_TOKEN_PARAMETER ?? `/yodev-mail-${input.environment}/providers/postmark/account-token`;
  const accountToken = await getSecureParameter(accountParameter, signal);
  const accountRequest = client(accountToken, "Account", signal);
  const serverName = `yodev-mail-${input.environment}-${input.workspaceId}`;
  const boundServerId = input.existingAccount?.externalAccountId;
  if (boundServerId && (!/^\d+$/.test(boundServerId) || !validId(Number(boundServerId)))) throw new Error("postmark_provisioning_identity_invalid");
  const priorServer = boundServerId ? undefined : await findUnique<PostmarkServer>(accountRequest, "servers", serverName);
  let server: PostmarkServer;
  if (boundServerId || priorServer) {
    const id = boundServerId ? Number(boundServerId) : priorServer!.ID;
    server = await accountRequest<PostmarkServer>(`/servers/${id}`);
    if (server.ID !== id || (!boundServerId && server.Name !== serverName)) throw new Error("postmark_provisioning_identity_invalid");
  } else {
    // A pending account without an ID represents an uncertain earlier create.
    // Reconcile by stable name; never issue a second create automatically.
    if (input.existingAccount) throw new Error("postmark_server_creation_requires_reconciliation");
    await input.checkpoint({});
    signal.throwIfAborted();
    server = await accountRequest<PostmarkServer>("/servers", {
      method: "POST",
      body: JSON.stringify({ Name: serverName, Color: "Blue", SmtpApiActivated: false, RawEmailEnabled: false,
        DeliveryType: input.environment === "prod" ? "Live" : "Sandbox", TrackOpens: false, TrackLinks: "None", IncludeBounceContentInHook: false }),
    });
    if (server.Name !== serverName) throw new Error("postmark_provisioning_identity_invalid");
  }
  if (!validId(server.ID)) throw new Error("postmark_provisioning_identity_invalid");
  assertPostmarkServerDeliveryType(server, input.environment);
  await input.checkpoint({ externalAccountId: String(server.ID) });
  const candidateToken = server.ApiTokens?.[0];
  if (!candidateToken || typeof candidateToken !== "string") throw new Error("postmark_provisioning_token_unavailable");
  const credentialPrefix = `/yodev-mail-${input.environment}/providers/postmark/workspaces/${input.workspaceId}`;
  const credentialParameterName = input.existingAccount?.credentialParameterName ?? `${credentialPrefix}/server-token`;
  if (!credentialParameterName.endsWith("/server-token")) throw new Error("postmark_credential_reference_invalid");
  const webhookParameterName = `${credentialParameterName.slice(0, -"/server-token".length)}/webhook-password`;
  const serverToken = input.existingAccount?.credentialParameterName
    ? await getSecureParameter(credentialParameterName, signal)
    : await createCredentialOnce(credentialParameterName, candidateToken, keyId!, signal);
  if (!server.ApiTokens?.includes(serverToken)) throw new Error("postmark_credential_identity_conflict");
  const webhookPassword = input.existingAccount?.credentialParameterName
    ? await getSecureParameter(webhookParameterName, signal)
    : await createCredentialOnce(webhookParameterName, randomBytes(32).toString("base64url"), keyId!, signal);
  await input.checkpoint({ externalAccountId: String(server.ID), credentialParameterName });

  const priorDomain = await findUnique<PostmarkDomain>(accountRequest, "domains", input.domain);
  const domain = priorDomain
    ? await accountRequest<PostmarkDomain>(`/domains/${priorDomain.ID}`)
    : await accountRequest<PostmarkDomain>("/domains", { method: "POST", body: JSON.stringify({ Name: input.domain, ReturnPathDomain: `pm-bounces.${input.domain}` }) });
  if (!validId(domain.ID) || domain.Name?.toLowerCase() !== input.domain.toLowerCase() || (priorDomain && domain.ID !== priorDomain.ID)) throw new Error("postmark_provisioning_identity_invalid");
  const serverRequest = client(serverToken, "Server", signal);
  const webhookUrl = `${webhookBaseUrl}/api/providers/postmark/${input.bindingId}`;
  const listed = await serverRequest<{ Webhooks: PostmarkWebhook[] }>("/webhooks?MessageStream=outbound");
  if (!Array.isArray(listed.Webhooks) || listed.Webhooks.some(item => !item || !validId(item.ID) || typeof item.Url !== "string")) throw new Error("postmark_provisioning_list_invalid");
  const matches = listed.Webhooks.filter(item => item.Url === webhookUrl);
  if (matches.length > 1) throw new Error("postmark_provisioning_identity_ambiguous");
  const priorWebhook = matches[0];
  if (!priorWebhook) {
    if (input.webhookCreationAttempted) throw new Error(POSTMARK_WEBHOOK_CREATE_UNCERTAIN);
    await input.beforeWebhookCreate();
  }
  const webhook = await serverRequest<PostmarkWebhook>(priorWebhook ? `/webhooks/${priorWebhook.ID}` : "/webhooks", {
    method: priorWebhook ? "PUT" : "POST",
    body: JSON.stringify({ Url: webhookUrl, ...(!priorWebhook ? { MessageStream: "outbound" } : {}), Verify: true,
      HttpAuth: { Username: "yodev-mail", Password: webhookPassword }, HttpHeaders: [],
      Triggers: { Open: { Enabled: false, PostFirstOpenOnly: true }, Click: { Enabled: false }, Delivery: { Enabled: true },
        Bounce: { Enabled: true, IncludeContent: false }, SpamComplaint: { Enabled: true, IncludeContent: false }, SubscriptionChange: { Enabled: false } },
    }),
  });
  if (!validId(webhook.ID) || webhook.Status !== "verified" || (priorWebhook && webhook.ID !== priorWebhook.ID)) throw new Error("postmark_webhook_verification_required");
  signal.throwIfAborted();
  const dkimName = domain.DKIMPendingHost ?? domain.DKIMHost;
  const dkimValue = domain.DKIMPendingTextValue ?? domain.DKIMTextValue;
  return {
    externalAccountId: String(server.ID), externalDomainId: String(domain.ID), credentialParameterName,
    records: [
      ...(dkimName && dkimValue ? [{ type: "TXT", name: dkimName, value: dkimValue }] : []),
      ...(domain.ReturnPathDomain && domain.ReturnPathDomainCNAMEValue ? [{ type: "CNAME", name: domain.ReturnPathDomain, value: domain.ReturnPathDomainCNAMEValue }] : []),
      { type: "TXT", name: `_dmarc.${input.domain}`, value: "v=DMARC1; p=none; rua=mailto:dmarc@yodev.fr; adkim=r; aspf=r; pct=100" },
    ],
  };
}
