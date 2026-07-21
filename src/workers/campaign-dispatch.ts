import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  campaignRecipients,
  campaigns,
  contacts,
  messages,
  outboxJobs,
  templates,
  templateVersions,
} from "@/db/schema";
import { evaluateStoredMessage } from "@/features/sending/eligibility";

const PAGE_SIZE = 250;

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failed: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await dispatch(JSON.parse(record.body).campaignId);
    } catch {
      failed.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failed };
}

async function dispatch(campaignId: string) {
  const db = requireDb();
  const [claimed] = await db
    .update(campaigns)
    .set({
      dispatchClaimedAt: new Date(),
      status: "dispatching",
      updatedAt: new Date(),
    })
    .where(
      and(eq(campaigns.id, campaignId), eq(campaigns.status, "scheduled")),
    )
    .returning();
  const campaign =
    claimed ??
    (await db
      .select()
      .from(campaigns)
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.status, "dispatching"),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]));
  if (!campaign) return;

  if (!campaign.templateId || !campaign.domainId) {
    await db
      .update(campaigns)
      .set({ failedCount: sql`${campaigns.failedCount} + 1`, status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.workspaceId, campaign.workspaceId),
        ),
      );
    return;
  }

  const [version] = await db
    .select({ html: templateVersions.html, plainText: templateVersions.plainText })
    .from(templateVersions)
    .innerJoin(templates, eq(templateVersions.templateId, templates.id))
    .where(
      and(
        eq(templateVersions.templateId, campaign.templateId),
        eq(templateVersions.workspaceId, campaign.workspaceId),
        eq(templates.workspaceId, campaign.workspaceId),
      ),
    )
    .orderBy(desc(templateVersions.version))
    .limit(1);
  if (!version) {
    await db
      .update(campaigns)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.workspaceId, campaign.workspaceId),
        ),
      );
    return;
  }

  if (claimed) {
    const [{ total }] = await db
      .select({ total: count() })
      .from(campaignRecipients)
      .where(and(eq(campaignRecipients.workspaceId, campaign.workspaceId), eq(campaignRecipients.campaignId, campaign.id)));
    await db
      .update(campaigns)
      .set({ recipientCount: total, updatedAt: new Date() })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.workspaceId, campaign.workspaceId),
        ),
      );
  }

  const recipients = await db
    .select({
      contactId: campaignRecipients.contactId,
      email: contacts.email,
      name: contacts.firstName,
      tracking: contacts.trackingConsent,
    })
    .from(campaignRecipients)
    .innerJoin(contacts, eq(campaignRecipients.contactId, contacts.id))
    .where(
      and(
        eq(campaignRecipients.campaignId, campaign.id),
        eq(campaignRecipients.workspaceId, campaign.workspaceId),
        eq(contacts.workspaceId, campaign.workspaceId),
        isNull(campaignRecipients.messageId),
        isNull(campaignRecipients.excludedAt),
      ),
    )
    .limit(PAGE_SIZE);

  let excluded = 0;
  await db.transaction(async (tx) => {
    for (const [index, recipient] of recipients.entries()) {
      const eligibility = await evaluateStoredMessage(db, {
        contactId: recipient.contactId,
        dailyOffset: index - excluded,
        domainId: campaign.domainId!,
        mode: "live",
        stream: "marketing",
        toEmail: recipient.email,
        workspaceId: campaign.workspaceId,
      });
      if (!eligibility.allowed) {
        excluded += 1;
        await tx
          .update(campaignRecipients)
          .set({
            eligibilitySnapshot: {
              allowed: false,
              code: eligibility.code,
              evaluatedAt: new Date().toISOString(),
            },
            excludedAt: new Date(),
            exclusionReason: eligibility.code,
          })
          .where(
            and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.workspaceId, campaign.workspaceId),
              eq(campaignRecipients.contactId, recipient.contactId),
            ),
          );
        continue;
      }

      const id = crypto.randomUUID();
      await tx.insert(messages).values({
        campaignId: campaign.id,
        contactId: recipient.contactId,
        contentExpiresAt: new Date(Date.now() + 30 * 864e5),
        domainId: campaign.domainId!,
        fromEmail: campaign.fromEmail,
        fromName: campaign.fromName,
        html: version.html,
        id,
        plainText: version.plainText,
        replyTo: campaign.replyTo,
        sendMode: "live",
        source: "campaign",
        stream: "marketing",
        subject: campaign.subject,
        toEmail: recipient.email,
        toName: recipient.name,
        trackingClicks: campaign.trackingClicks && recipient.tracking,
        trackingOpens: campaign.trackingOpens && recipient.tracking,
        workspaceId: campaign.workspaceId,
      });
      await tx.insert(outboxJobs).values({
        aggregateId: id,
        kind: "email",
        workspaceId: campaign.workspaceId,
      });
      await tx
        .update(campaignRecipients)
        .set({
          eligibilitySnapshot: {
            allowed: true,
            evaluatedAt: new Date().toISOString(),
          },
          messageId: id,
        })
        .where(
          and(
              eq(campaignRecipients.campaignId, campaign.id),
              eq(campaignRecipients.workspaceId, campaign.workspaceId),
            eq(campaignRecipients.contactId, recipient.contactId),
          ),
        );
    }
  });

  if (excluded) {
    await db
      .update(campaigns)
      .set({
        suppressedCount: sql`${campaigns.suppressedCount} + ${excluded}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.workspaceId, campaign.workspaceId),
        ),
      );
  }

  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(campaignRecipients)
    .where(
      and(
        eq(campaignRecipients.campaignId, campaign.id),
        eq(campaignRecipients.workspaceId, campaign.workspaceId),
        isNull(campaignRecipients.messageId),
        isNull(campaignRecipients.excludedAt),
      ),
    );
  if (remaining > 0) {
    await db.insert(outboxJobs).values({
      aggregateId: campaign.id,
      kind: "campaign",
      workspaceId: campaign.workspaceId,
    });
  } else {
    await db
      .update(campaigns)
      .set({
        sentAt: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} >= ${campaigns.recipientCount} then now() else ${campaigns.sentAt} end`,
        status: sql`case when ${campaigns.acceptedCount} + ${campaigns.suppressedCount} + ${campaigns.failedCount} >= ${campaigns.recipientCount} then 'sent'::campaign_status else 'sending'::campaign_status end`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(campaigns.id, campaign.id),
          eq(campaigns.workspaceId, campaign.workspaceId),
        ),
      );
  }
}
