import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { and, eq, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  campaigns,
  messageAttempts,
  messages,
  usageDays,
  usageLedger,
  usageMonths,
  workspaces,
} from "@/db/schema";
import {
  evaluateStoredMessage,
  utcDay,
} from "@/features/sending/eligibility";
import { awsClients } from "@/lib/aws";
import { signExpiringToken } from "@/lib/crypto";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  await loadRuntimeSecrets();
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
  const eligibility = await evaluateStoredMessage(db, {
    contactId: claimed.contactId,
    domainId: claimed.domainId,
    mode: claimed.sendMode,
    stream: claimed.stream,
    toEmail: claimed.toEmail,
    workspaceId: claimed.workspaceId,
  });
  if (!eligibility.allowed) {
    const status = eligibility.code === "recipient_suppressed" ? "suppressed" : "failed";
    await db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ lastError: eligibility.reason, status, updatedAt: new Date() })
        .where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
      await tx
        .insert(usageDays)
        .values({
          day: utcDay(),
          failedEmails: status === "failed" ? 1 : 0,
          suppressedEmails: status === "suppressed" ? 1 : 0,
          workspaceId: claimed.workspaceId,
        })
        .onConflictDoUpdate({
          target: [usageDays.workspaceId, usageDays.day],
          set: {
            failedEmails:
              status === "failed"
                ? sql`${usageDays.failedEmails} + 1`
                : sql`${usageDays.failedEmails}`,
            suppressedEmails:
              status === "suppressed"
                ? sql`${usageDays.suppressedEmails} + 1`
                : sql`${usageDays.suppressedEmails}`,
            updatedAt: new Date(),
          },
        });
      if (claimed.campaignId) {
        await tx
          .update(campaigns)
          .set({
            failedCount:
              status === "failed"
                ? sql`${campaigns.failedCount} + 1`
                : sql`${campaigns.failedCount}`,
            suppressedCount:
              status === "suppressed"
                ? sql`${campaigns.suppressedCount} + 1`
                : sql`${campaigns.suppressedCount}`,
            sentAt: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} + 1 >= ${campaigns.recipientCount} then now() else ${campaigns.sentAt} end`,
            status: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} + 1 >= ${campaigns.recipientCount} then 'sent'::campaign_status else ${campaigns.status} end`,
            updatedAt: new Date(),
          })
          .where(and(eq(campaigns.id, claimed.campaignId), eq(campaigns.workspaceId, claimed.workspaceId)));
      }
    });
    return;
  }
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, claimed.workspaceId)).limit(1);
  if (!workspace?.sesTenantName) {
    await db.transaction(async (tx) => {
      await tx.update(messages).set({ status: "failed", lastError: "SES tenant is missing", updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId)));
      await tx.insert(usageDays).values({ workspaceId: claimed.workspaceId, day: utcDay(), failedEmails: 1 }).onConflictDoUpdate({ target: [usageDays.workspaceId, usageDays.day], set: { failedEmails: sql`${usageDays.failedEmails} + 1`, updatedAt: new Date() } });
      if (claimed.campaignId) await tx.update(campaigns).set({ failedCount: sql`${campaigns.failedCount} + 1`, sentAt: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} + 1 >= ${campaigns.recipientCount} then now() else ${campaigns.sentAt} end`, status: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} + 1 >= ${campaigns.recipientCount} then 'sent'::campaign_status else ${campaigns.status} end`, updatedAt: new Date() }).where(and(eq(campaigns.id, claimed.campaignId), eq(campaigns.workspaceId, claimed.workspaceId)));
    });
    return;
  }
  const configSuffix = claimed.stream === "transactional" ? "txn" : claimed.trackingClicks || claimed.trackingOpens ? "mkt-tracked" : "mkt-private";
  const unsubscribeToken = claimed.stream === "marketing" && claimed.contactId && process.env.UNSUBSCRIBE_SIGNING_SECRET ? signExpiringToken({ workspaceId: claimed.workspaceId, contactId: claimed.contactId }, process.env.UNSUBSCRIBE_SIGNING_SECRET, new Date(Date.now() + 366 * 864e5)) : null;
  const unsubscribeUrl = unsubscribeToken ? `${process.env.PUBLIC_LINKS_URL ?? "https://links.mail.yodev.fr"}/u/${unsubscribeToken}` : null;
  const html = unsubscribeUrl ? `${claimed.html}<p style="margin-top:32px;font-size:12px;color:#71717a">Vous recevez cet email de ${claimed.fromName ?? claimed.fromEmail}. <a href="${unsubscribeUrl}">Se désabonner</a></p>` : claimed.html;
  const plainText = unsubscribeUrl ? `${claimed.plainText}\n\nSe désabonner : ${unsubscribeUrl}` : claimed.plainText;
  const { ses } = await awsClients();
  let result;
  try {
    result = await ses.send(new SendEmailCommand({
      TenantName: workspace.sesTenantName,
      ConfigurationSetName: `${workspace.sesTenantName}-${configSuffix}`,
      FromEmailAddress: claimed.fromName ? `${claimed.fromName} <${claimed.fromEmail}>` : claimed.fromEmail,
      Destination: { ToAddresses: [claimed.toName ? `${claimed.toName} <${claimed.toEmail}>` : claimed.toEmail] },
      ReplyToAddresses: claimed.replyTo ? [claimed.replyTo] : undefined,
      Content: { Simple: { Subject: { Data: claimed.subject, Charset: "UTF-8" }, Body: { Html: { Data: html, Charset: "UTF-8" }, Text: { Data: plainText, Charset: "UTF-8" } }, Headers: unsubscribeUrl ? [{ Name: "List-Unsubscribe", Value: `<${unsubscribeUrl}>` }, { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" }] : undefined } },
      EmailTags: [{ Name: "ym_message_id", Value: claimed.id }, { Name: "ym_workspace_id", Value: claimed.workspaceId }],
    }));
  } catch (error) {
    await db.update(messages).set({ status: "queued", lastError: error instanceof Error ? error.message : "SES send failed", updatedAt: new Date() }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId), eq(messages.status, "sending")));
    throw error;
  }

  // SES accepted the message. From this point onward, never return it to `queued`:
  // an event carrying the Mail by Yodev tags will reconcile an ambiguous database write.
  const acceptedAt = new Date();
  const month = acceptedAt.toISOString().slice(0, 7);
  await db.transaction(async tx => {
    await tx.update(messages).set({ status: "sent", sesMessageId: result.MessageId, acceptedAt, sentAt: acceptedAt, updatedAt: acceptedAt }).where(and(eq(messages.id, claimed.id), eq(messages.workspaceId, claimed.workspaceId), eq(messages.status, "sending")));
    const ledger = await tx
      .insert(usageLedger)
      .values({ acceptedAt, messageId: claimed.id, workspaceId: claimed.workspaceId })
      .onConflictDoNothing()
      .returning();
    await tx.insert(messageAttempts).values({ workspaceId: claimed.workspaceId, messageId: claimed.id, attempt: 1, status: "accepted" }).onConflictDoNothing();
    if (ledger.length) {
      await tx.insert(usageMonths).values({ workspaceId: claimed.workspaceId, month, acceptedEmails: 1 }).onConflictDoUpdate({ target: [usageMonths.workspaceId, usageMonths.month], set: { acceptedEmails: sql`${usageMonths.acceptedEmails} + 1`, updatedAt: acceptedAt } });
      await tx.insert(usageDays).values({ workspaceId: claimed.workspaceId, day: utcDay(acceptedAt), acceptedEmails: 1 }).onConflictDoUpdate({ target: [usageDays.workspaceId, usageDays.day], set: { acceptedEmails: sql`${usageDays.acceptedEmails} + 1`, updatedAt: acceptedAt } });
      if (claimed.campaignId) {
        await tx.update(campaigns).set({ acceptedCount: sql`${campaigns.acceptedCount} + 1`, sentAt: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} + 1 >= ${campaigns.recipientCount} then ${acceptedAt} else ${campaigns.sentAt} end`, status: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} + 1 >= ${campaigns.recipientCount} then 'sent'::campaign_status else ${campaigns.status} end`, updatedAt: acceptedAt }).where(and(eq(campaigns.id, claimed.campaignId), eq(campaigns.workspaceId, claimed.workspaceId)));
      }
    }
  });
}
