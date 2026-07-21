import { resolveTxt } from "node:dns/promises";
import { GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { awsClients } from "@/lib/aws";

function normalizedStatus(value?: string) {
  if (value === "SUCCESS") return "verified";
  if (value === "FAILED" || value === "TEMPORARY_FAILURE") return "failed";
  return "pending";
}

async function dmarcStatus(domain: string) {
  try {
    const records = await resolveTxt(`_dmarc.${domain}`);
    return records.some((record) =>
      record.join("").trim().toUpperCase().startsWith("V=DMARC1"),
    )
      ? "verified"
      : "missing";
  } catch {
    return "missing";
  }
}

export async function checkSesDomain(domain: string) {
  const { ses } = await awsClients();
  const identity = await ses.send(
    new GetEmailIdentityCommand({ EmailIdentity: domain }),
  );
  const dkimStatus = normalizedStatus(identity.DkimAttributes?.Status);
  const mailFromStatus = normalizedStatus(
    identity.MailFromAttributes?.MailFromDomainStatus,
  );
  return {
    dkimStatus,
    dmarcStatus: await dmarcStatus(domain),
    mailFromStatus,
    status:
      identity.VerifiedForSendingStatus && dkimStatus === "verified"
        ? ("verified" as const)
        : ("pending" as const),
  };
}
