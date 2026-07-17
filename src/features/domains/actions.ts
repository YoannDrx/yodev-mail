"use server";
import { count,eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents,domains,sesResources,workspaces } from "@/db/schema";
import { provisionSesDomain } from "@/features/domains/provision-ses-domain";
import { currentWorkspace } from "@/lib/current-workspace";
import { planCatalog } from "@/lib/plans";
const domainSchema=z.string().trim().toLowerCase().regex(/^(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/);
export async function addDomainAction(value:string){const name=domainSchema.parse(value);const {workspace,userId}=await currentWorkspace({admin:true});const [{total}]=await requireDb().select({total:count()}).from(domains).where(eq(domains.workspaceId,workspace.id));const limit=workspace.plan==="sandbox"?1:planCatalog[workspace.plan].domains;if(total>=limit)throw new Error("Domain limit reached for this plan");const id=crypto.randomUUID();await requireDb().insert(domains).values({id,workspaceId:workspace.id,name,mailFromDomain:`bounce.${name}`});try{const provisioned=await provisionSesDomain({workspaceId:workspace.id,domain:name});await requireDb().transaction(async tx=>{await tx.update(workspaces).set({sesTenantName:provisioned.tenantName,updatedAt:new Date()}).where(eq(workspaces.id,workspace.id));await tx.update(domains).set({dkimTokens:provisioned.tokens,dnsRecords:provisioned.records,updatedAt:new Date()}).where(eq(domains.id,id));await tx.insert(sesResources).values(provisioned.configurationSets.map(resourceName=>({workspaceId:workspace.id,domainId:id,resourceType:"configuration_set",resourceName})));await tx.insert(auditEvents).values({workspaceId:workspace.id,actorUserId:userId,action:"domain.created",entityType:"domain",entityId:id,metadata:{domain:name}})});revalidatePath("/dashboard/domaines");return provisioned.records}catch(error){await requireDb().update(domains).set({status:"failed",updatedAt:new Date()}).where(eq(domains.id,id));throw error}}
