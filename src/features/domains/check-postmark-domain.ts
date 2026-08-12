import { getSecureParameter } from "@/workers/runtime-secrets";

type PostmarkDomain = {
  DKIMVerified?: boolean;
  ReturnPathDomainVerified?: boolean;
};

export async function checkPostmarkDomain(externalDomainId: string) {
  const environment = process.env.DEPLOYMENT_ENVIRONMENT === "prod" || process.env.VERCEL_ENV === "production" ? "prod" : "dev";
  const accountParameter = process.env.POSTMARK_ACCOUNT_TOKEN_PARAMETER ?? `/yodev-mail-${environment}/providers/postmark/account-token`;
  const token = await getSecureParameter(accountParameter);
  const response = await fetch(`https://api.postmarkapp.com/domains/${encodeURIComponent(externalDomainId)}`, {
    headers: { Accept: "application/json", "X-Postmark-Account-Token": token },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Postmark domain check failed (${response.status}).`);
  const domain = await response.json() as PostmarkDomain;
  return {
    dkimStatus: domain.DKIMVerified ? "verified" : "pending",
    returnPathStatus: domain.ReturnPathDomainVerified ? "verified" : "pending",
    status: domain.DKIMVerified && domain.ReturnPathDomainVerified ? ("verified" as const) : ("dns_pending" as const),
  };
}
