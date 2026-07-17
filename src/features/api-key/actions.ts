"use server";
import { revalidatePath } from "next/cache";
import { eq,and } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import { apiKeys,auditEvents } from "@/db/schema";
import { createApiKey } from "@/lib/crypto";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";
const createSchema=z.object({name:z.string().min(2).max(120),mode:z.enum(["test","live"]),scopes:z.array(z.enum(["emails:send","emails:read","webhooks:manage"])).min(1)});
export async function createApiKeyAction(input:z.infer<typeof createSchema>){const data=createSchema.parse(input);if(!env.API_KEY_PEPPER)throw new Error("API key pepper is not configured");const {workspace,userId}=await currentWorkspace({admin:true});if(data.mode==="live"&&workspace.status!=="approved")throw new Error("Live keys require an approved workspace");const generated=createApiKey(data.mode,env.API_KEY_PEPPER);await requireDb().transaction(async tx=>{await tx.insert(apiKeys).values({workspaceId:workspace.id,name:data.name,mode:data.mode,prefix:generated.prefix,secretHash:generated.secretHash,scopes:data.scopes,createdBy:userId});await tx.insert(auditEvents).values({workspaceId:workspace.id,actorUserId:userId,action:"api_key.created",entityType:"api_key",metadata:{mode:data.mode,scopes:data.scopes}})});revalidatePath("/dashboard/api-keys");return {token:generated.token}}
export async function revokeApiKeyAction(id:string){const {workspace,userId}=await currentWorkspace({admin:true});await requireDb().transaction(async tx=>{await tx.update(apiKeys).set({revokedAt:new Date(),updatedAt:new Date()}).where(and(eq(apiKeys.id,z.string().uuid().parse(id)),eq(apiKeys.workspaceId,workspace.id)));await tx.insert(auditEvents).values({workspaceId:workspace.id,actorUserId:userId,action:"api_key.revoked",entityType:"api_key",entityId:id})});revalidatePath("/dashboard/api-keys")}
