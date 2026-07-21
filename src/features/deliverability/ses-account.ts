import "server-only";
import { GetAccountCommand } from "@aws-sdk/client-sesv2";
import { awsClients } from "@/lib/aws";
import { env } from "@/lib/env";

export async function getSesAccountStatus() {
  if (!env.AWS_ROLE_ARN) return null;
  try {
    const { ses } = await awsClients();
    const account = await ses.send(new GetAccountCommand({}));
    return {
      enforcementStatus: account.EnforcementStatus ?? "UNKNOWN",
      max24HourSend: account.SendQuota?.Max24HourSend ?? 0,
      maxSendRate: account.SendQuota?.MaxSendRate ?? 0,
      productionAccess: account.ProductionAccessEnabled ?? false,
      sendingEnabled: account.SendingEnabled ?? false,
      sentLast24Hours: account.SendQuota?.SentLast24Hours ?? 0,
    };
  } catch {
    return null;
  }
}
