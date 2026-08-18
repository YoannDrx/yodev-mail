"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, workspaceSettings } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";
const schema=z.object({companyAddress:z.string().trim().max(500).optional(),companyName:z.string().trim().max(180).optional(),defaultFromName:z.string().trim().max(140).optional(),defaultReplyTo:z.string().email().optional()});
export async function updateSettingsAction(formData:FormData){const data=schema.parse({...Object.fromEntries(formData),defaultReplyTo:formData.get("defaultReplyTo")||undefined});const {workspace,userId}=await currentWorkspace({admin:true});await requireDb().transaction(async(tx)=>{await tx.insert(workspaceSettings).values({workspaceId:workspace.id,...data}).onConflictDoUpdate({target:workspaceSettings.workspaceId,set:{...data,updatedAt:new Date()}});await tx.insert(auditEvents).values({action:"workspace.settings_updated",actorUserId:userId,entityId:workspace.id,entityType:"workspace",workspaceId:workspace.id})});revalidatePath("/dashboard/parametres")}
