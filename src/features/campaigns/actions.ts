"use server";

import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
} from "@aws-sdk/client-scheduler";
import { and, count, eq, isNotNull, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  auditEvents,
  campaignRecipients,
  campaigns,
  contactListMembers,
  contactLists,
  contacts,
  domains,
  subscriptions,
  templates,
} from "@/db/schema";
import { awsClients } from "@/lib/aws";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";

const createSchema = z.object({
  domainId: z.string().uuid(),
  fromEmail: z.string().email(),
  fromName: z.string().trim().min(2).max(140),
  listId: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(180),
  replyTo: z.string().email().optional(),
  subject: z.string().trim().min(1).max(255),
  templateId: z.string().uuid(),
  trackingClicks: z.boolean().default(false),
  trackingOpens: z.boolean().default(false),
});

export async function createCampaignAction(formData: FormData) {
  const data = createSchema.parse({
    ...Object.fromEntries(formData),
    replyTo: formData.get("replyTo") || undefined,
    listId: formData.get("listId") || undefined,
    trackingClicks: formData.get("trackingClicks") === "on",
    trackingOpens: formData.get("trackingOpens") === "on",
  });
  const { workspace, userId } = await currentWorkspace();
  const db = requireDb();
  const [domain, template, list] = await Promise.all([
    db.select().from(domains).where(and(eq(domains.id, data.domainId), eq(domains.workspaceId, workspace.id))).limit(1).then((rows) => rows[0]),
    db.select().from(templates).where(and(eq(templates.id, data.templateId), eq(templates.workspaceId, workspace.id))).limit(1).then((rows) => rows[0]),
    data.listId
      ? db.select().from(contactLists).where(and(eq(contactLists.id, data.listId), eq(contactLists.workspaceId, workspace.id))).limit(1).then((rows) => rows[0])
      : Promise.resolve(undefined),
  ]);
  if (!domain || !template || (data.listId && !list)) throw new Error("Domaine, template ou liste invalide");
  const eligibilityFilter = and(
    eq(contacts.workspaceId, workspace.id),
    eq(contacts.status, "active"),
    or(eq(contacts.marketingConsent, true), isNotNull(contacts.legalBasis)),
  );
  const eligibleContacts = data.listId
    ? await db
        .select({ id: contacts.id })
        .from(contactListMembers)
        .innerJoin(contacts, eq(contactListMembers.contactId, contacts.id))
        .where(and(eq(contactListMembers.workspaceId, workspace.id), eq(contactListMembers.listId, data.listId), eligibilityFilter))
    : await db.select({ id: contacts.id }).from(contacts).where(eligibilityFilter);
  const senderDomain = data.fromEmail.split("@").at(-1)?.toLowerCase();
  if (senderDomain !== domain.name && !senderDomain?.endsWith(`.${domain.name}`)) {
    throw new Error("L’adresse From doit utiliser le domaine sélectionné");
  }
  const campaignId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(campaigns).values({
      createdBy: userId,
      domainId: domain.id,
      fromEmail: data.fromEmail,
      fromName: data.fromName,
      id: campaignId,
      listId: data.listId,
      name: data.name,
      recipientCount: eligibleContacts.length,
      replyTo: data.replyTo,
      subject: data.subject,
      templateId: template.id,
      trackingClicks: data.trackingClicks,
      trackingOpens: data.trackingOpens,
      workspaceId: workspace.id,
    });
    if (eligibleContacts.length) {
      await tx.insert(campaignRecipients).values(
        eligibleContacts.map((contact) => ({
          workspaceId: workspace.id,
          campaignId,
          contactId: contact.id,
          eligibilitySnapshot: { frozenAt: new Date().toISOString() },
        })),
      );
    }
    await tx.insert(auditEvents).values({
      action: "campaign.created",
      actorUserId: userId,
      entityId: campaignId,
      entityType: "campaign",
      metadata: { audience: eligibleContacts.length },
      workspaceId: workspace.id,
    });
  });
  revalidatePath("/dashboard/campagnes");
}

export async function scheduleCampaignAction(campaignId:string,date:string){const id=z.string().uuid().parse(campaignId);const scheduledAt=z.coerce.date().min(new Date(Date.now()+60_000)).parse(date);if(!env.AWS_CAMPAIGN_QUEUE_ARN||!env.AWS_SCHEDULER_ROLE_ARN)throw new Error("AWS Scheduler is not configured");const {workspace}=await currentWorkspace();if(workspace.status!=="approved")throw new Error("Workspace approval is required");const db=requireDb();const [subscription]=await db.select().from(subscriptions).where(eq(subscriptions.workspaceId,workspace.id)).limit(1);if(!subscription||!["active","trialing"].includes(subscription.status))throw new Error("Active subscription is required");const [campaign]=await db.update(campaigns).set({status:"scheduled",scheduledAt,updatedAt:new Date()}).where(and(eq(campaigns.id,id),eq(campaigns.workspaceId,workspace.id),eq(campaigns.status,"draft"))).returning();if(!campaign)throw new Error("Campaign cannot be scheduled");const [{total}]=await db.select({total:count()}).from(campaignRecipients).where(and(eq(campaignRecipients.workspaceId,workspace.id),eq(campaignRecipients.campaignId,id)));if(total===0){await db.update(campaigns).set({status:"draft",updatedAt:new Date()}).where(and(eq(campaigns.id,id),eq(campaigns.workspaceId,workspace.id)));throw new Error("Campaign audience is empty")}const {scheduler}=await awsClients();try{await scheduler.send(new CreateScheduleCommand({Name:`campaign-${id}`,GroupName:env.AWS_SCHEDULER_GROUP,ClientToken:id,ScheduleExpression:`at(${scheduledAt.toISOString().replace(/\.\d{3}Z$/,"Z")})`,FlexibleTimeWindow:{Mode:"OFF"},ActionAfterCompletion:"DELETE",Target:{Arn:env.AWS_CAMPAIGN_QUEUE_ARN,RoleArn:env.AWS_SCHEDULER_ROLE_ARN,Input:JSON.stringify({campaignId:id})}}))}catch(error){await db.update(campaigns).set({status:"draft",scheduledAt:null,updatedAt:new Date()}).where(and(eq(campaigns.id,id),eq(campaigns.workspaceId,workspace.id)));throw error}revalidatePath("/dashboard/campagnes")}

export async function scheduleCampaignFormAction(campaignId: string, formData: FormData) {
  const date = z.string().min(1).parse(formData.get("scheduledAt"));
  return scheduleCampaignAction(campaignId, date);
}

export async function cancelCampaignAction(campaignId:string){const id=z.string().uuid().parse(campaignId);const {workspace}=await currentWorkspace();const [campaign]=await requireDb().update(campaigns).set({status:"canceled",updatedAt:new Date()}).where(and(eq(campaigns.id,id),eq(campaigns.workspaceId,workspace.id),eq(campaigns.status,"scheduled"))).returning();if(!campaign)throw new Error("Campaign already started or cannot be canceled");const {scheduler}=await awsClients();await scheduler.send(new DeleteScheduleCommand({Name:`campaign-${id}`,GroupName:env.AWS_SCHEDULER_GROUP}));revalidatePath("/dashboard/campagnes")}
