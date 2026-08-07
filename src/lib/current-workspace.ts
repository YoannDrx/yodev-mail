import "server-only";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";
import { requireDb } from "@/db";
import { subscriptions, workspaceSettings, workspaces } from "@/db/schema";
import { isClerkConfigured } from "@/lib/env";

export async function currentWorkspace(options:{admin?:boolean}={}){
  if(!isClerkConfigured())throw new Error("Clerk must be configured for database mutations");
  const session=await auth();if(!session.userId||!session.orgId)throw new Error("Sélectionnez une organisation Mail by Yodev");
  if(options.admin&&!session.has({role:"org:admin"}))throw new Error("Workspace administrator role required");
  const db = requireDb();
  let [workspace]=await db.select().from(workspaces).where(and(eq(workspaces.clerkOrganizationId,session.orgId), isNull(workspaces.deletedAt))).limit(1);
  if (!workspace) {
    const clerk = await clerkClient();
    const organization = await clerk.organizations.getOrganization({
      organizationId: session.orgId,
    });
    await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(workspaces)
        .values({
          clerkOrganizationId: organization.id,
          name: organization.name,
          ownerUserId: session.userId!,
          slug: organization.slug ?? organization.id,
          status: "sandbox",
          dailyLimit: 200,
        })
        .onConflictDoNothing()
        .returning();
      if (!created) return;
      await tx.insert(workspaceSettings).values({ workspaceId: created.id });
      await tx.insert(subscriptions).values({ workspaceId: created.id });
    });
    [workspace] = await db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.clerkOrganizationId, session.orgId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
  }
  if(!workspace)throw new Error("Workspace has not been provisioned yet");
  return {workspace,userId:session.userId,orgId:session.orgId};
}
