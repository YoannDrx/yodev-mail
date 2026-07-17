import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq, sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { messageAttempts, messages, usageMonths, workspaces } from "@/db/schema";
import { awsClients } from "@/lib/aws";
import { signExpiringToken } from "@/lib/crypto";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try { await sendOne(JSON.parse(record.body).messageId); } catch { failures.push({ itemIdentifier: record.messageId }); }
  }
  return { batchItemFailures: failures };
}

async function sendOne(messageId: string) {
  const db = requireDb();
  const [claimed] = await db.update(messages).set({ status: "sending", sendingClaimedAt: new Date(), updatedAt: new Date() }).where(and(eq(messages.id, messageId), eq(messages.status, "queued"))).returning();
  if (!claimed) return;
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, claimed.workspaceId)).limit(1);
  if (!workspace?.sesTenantName) throw new Error("SES tenant is missing");
  const configSuffix = claimed.stream === "transactional" ? "txn" : claimed.trackingClicks || claimed.trackingOpens ? "mkt-tracked" : "mkt-private";
  try {
    const unsubscribeToken = claimed.stream === "marketing" && claimed.contactId && process.env.UNSUBSCRIBE_SIGNING_SECRET ? signExpiringToken({ workspaceId: claimed.workspaceId, contactId: claimed.contactId }, process.env.UNSUBSCRIBE_SIGNING_SECRET, new Date(Date.now() + 366 * 864e5)) : null;
    const unsubscribeUrl = unsubscribeToken ? `${process.env.PUBLIC_LINKS_URL ?? "https://links.vigie-mail.fr"}/u/${unsubscribeToken}` : null;
    const html = unsubscribeUrl ? `${claimed.html}<p style="margin-top:32px;font-size:12px;color:#71717a">Vous recevez cet email de ${claimed.fromName ?? claimed.fromEmail}. <a href="${unsubscribeUrl}">Se désabonner</a></p>` : claimed.html;
    const plainText = unsubscribeUrl ? `${claimed.plainText}\n\nSe désabonner : ${unsubscribeUrl}` : claimed.plainText;
    const { ses } = await awsClients();
    const result = await ses.send(new SendEmailCommand({
      TenantName: workspace.sesTenantName,
      ConfigurationSetName: `${workspace.sesTenantName}-${configSuffix}`,
      FromEmailAddress: claimed.fromName ? `${claimed.fromName} <${claimed.fromEmail}>` : claimed.fromEmail,
      Destination: { ToAddresses: [claimed.toName ? `${claimed.toName} <${claimed.toEmail}>` : claimed.toEmail] },
      ReplyToAddresses: claimed.replyTo ? [claimed.replyTo] : undefined,
      Content: { Simple: { Subject: { Data: claimed.subject, Charset: "UTF-8" }, Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: plainText, Charset: "UTF-8" } }, Headers: unsubscribeUrl ? [{ Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }] : undefined } },
      EmailTags: [{ Name: "vm_message_id", Value: claimed.id }, { Name: "vm_workspace_id", Value: claimed.workspaceId }],
    }));
    const month = new Date().toISOString().slice(0, 7);
    await db.transaction(async tx => {
      await tx.update(messages).set({ status: "sent", sesMessageId: result.MessageId, sentAt: new Date(), updatedAt: new Date() }).where(eq(messages.id, claimed.id));
      await tx.insert(messageAttempts).values({ messageId: claimed.id, attempt: 1, status: "accepted" }).onConflictDoNothing();
      await tx.insert(usageMonths).values({ workspaceId: claimed.workspaceId, month, acceptedEmails: 1 }).onConflictDoUpdate({ target: [usageMonths.workspaceId, usageMonths.month], set: { acceptedEmails: sql`${usageMonths.acceptedEmails} + 1`, updatedAt: new Date() } });
    });
  } catch (error) {
    await db.update(messages).set({ status: "queued", lastError: error instanceof Error ? error.message : "SES send failed", updatedAt: new Date() }).where(eq(messages.id, claimed.id));
    throw error;
  }
}
