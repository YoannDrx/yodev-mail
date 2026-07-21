"use server";
import { and, count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents,domains,sesResources,workspaces } from "@/db/schema";
import { provisionSesDomain } from "@/features/domains/provision-ses-domain";
import { checkSesDomain } from "@/features/domains/check-domain";
import { currentWorkspace } from "@/lib/current-workspace";
import { planCatalog } from "@/lib/plans";
const domainSchema=z.string().trim().toLowerCase().regex(/^(?!-)(?:[a-z0-9-]+\.)+[a-z]{2,63}$/);
export async function addDomainAction(value:string|FormData){const raw=value instanceof FormData?value.get("domain"):value;const name=domainSchema.parse(raw);const {workspace,userId}=await currentWorkspace({admin:true});const [{total}]=await requireDb().select({total:count()}).from(domains).where(eq(domains.workspaceId,workspace.id));const limit=workspace.plan==="sandbox"?1:planCatalog[workspace.plan].domains;if(total>=limit)throw new Error("Domain limit reached for this plan");const id=crypto.randomUUID();await requireDb().insert(domains).values({id,workspaceId:workspace.id,name,mailFromDomain:`bounce.${name}`});try{const provisioned=await provisionSesDomain({workspaceId:workspace.id,domain:name});await requireDb().transaction(async tx=>{await tx.update(workspaces).set({sesTenantName:provisioned.tenantName,updatedAt:new Date()}).where(eq(workspaces.id,workspace.id));await tx.update(domains).set({dkimTokens:provisioned.tokens,dnsRecords:provisioned.records,updatedAt:new Date()}).where(and(eq(domains.id,id),eq(domains.workspaceId,workspace.id)));await tx.insert(sesResources).values(provisioned.configurationSets.map(resourceName=>({workspaceId:workspace.id,domainId:id,resourceType:"configuration_set",resourceName})));await tx.insert(auditEvents).values({workspaceId:workspace.id,actorUserId:userId,action:"domain.created",entityType:"domain",entityId:id,metadata:{domain:name}})});revalidatePath("/dashboard/domaines")}catch(error){await requireDb().update(domains).set({status:"failed",updatedAt:new Date()}).where(and(eq(domains.id,id),eq(domains.workspaceId,workspace.id)));throw error}}

export async function refreshDomainAction(domainId: string) {
  const id = z.string().uuid().parse(domainId);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const db = requireDb();
  const [domain] = await db
    .select()
    .from(domains)
    .where(and(eq(domains.id, id), eq(domains.workspaceId, workspace.id)))
    .limit(1);
  if (!domain) throw new Error("Domain not found");
  try {
    const checked = await checkSesDomain(domain.name);
    const verifiedAt = checked.status === "verified" ? domain.verifiedAt ?? new Date() : null;
    await db.transaction(async (tx) => {
      await tx
        .update(domains)
        .set({
          ...checked,
          lastCheckError: null,
          lastCheckedAt: new Date(),
          updatedAt: new Date(),
          verifiedAt,
        })
        .where(and(eq(domains.id, id), eq(domains.workspaceId, workspace.id)));
      await tx.insert(auditEvents).values({
        action: "domain.checked",
        actorUserId: userId,
        entityId: id,
        entityType: "domain",
        metadata: checked,
        workspaceId: workspace.id,
      });
    });
    revalidatePath("/dashboard/domaines");
  } catch (error) {
    await db
      .update(domains)
      .set({
        lastCheckError: error instanceof Error ? error.message : "Domain check failed",
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(domains.id, id), eq(domains.workspaceId, workspace.id)));
    throw error;
  }
}
