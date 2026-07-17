"use server";
import { CreateScheduleCommand,DeleteScheduleCommand } from "@aws-sdk/client-scheduler";
import { and,eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { campaigns } from "@/db/schema";
import { awsClients } from "@/lib/aws";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";
export async function scheduleCampaignAction(campaignId:string,date:string){const id=z.string().uuid().parse(campaignId);const scheduledAt=z.coerce.date().min(new Date(Date.now()+60_000)).parse(date);if(!env.AWS_CAMPAIGN_QUEUE_ARN||!env.AWS_SCHEDULER_ROLE_ARN)throw new Error("AWS Scheduler is not configured");const {workspace}=await currentWorkspace();const [campaign]=await requireDb().update(campaigns).set({status:"scheduled",scheduledAt,updatedAt:new Date()}).where(and(eq(campaigns.id,id),eq(campaigns.workspaceId,workspace.id),eq(campaigns.status,"draft"))).returning();if(!campaign)throw new Error("Campaign cannot be scheduled");const {scheduler}=await awsClients();await scheduler.send(new CreateScheduleCommand({Name:`campaign-${id}`,GroupName:env.AWS_SCHEDULER_GROUP,ClientToken:id,ScheduleExpression:`at(${scheduledAt.toISOString().replace(/\.\d{3}Z$/,"Z")})`,FlexibleTimeWindow:{Mode:"OFF"},ActionAfterCompletion:"DELETE",Target:{Arn:env.AWS_CAMPAIGN_QUEUE_ARN,RoleArn:env.AWS_SCHEDULER_ROLE_ARN,Input:JSON.stringify({campaignId:id})}}));revalidatePath("/dashboard/campagnes")}
export async function cancelCampaignAction(campaignId:string){const id=z.string().uuid().parse(campaignId);const {workspace}=await currentWorkspace();const [campaign]=await requireDb().update(campaigns).set({status:"canceled",updatedAt:new Date()}).where(and(eq(campaigns.id,id),eq(campaigns.workspaceId,workspace.id),eq(campaigns.status,"scheduled"))).returning();if(!campaign)throw new Error("Campaign already started or cannot be canceled");const {scheduler}=await awsClients();await scheduler.send(new DeleteScheduleCommand({Name:`campaign-${id}`,GroupName:env.AWS_SCHEDULER_GROUP}));revalidatePath("/dashboard/campagnes")}
