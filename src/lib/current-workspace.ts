import "server-only";
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { requireDb } from "@/db";
import { workspaces } from "@/db/schema";
import { isClerkConfigured } from "@/lib/env";

export async function currentWorkspace(options:{admin?:boolean}={}){
  if(!isClerkConfigured())throw new Error("Clerk must be configured for database mutations");
  const session=await auth();if(!session.userId||!session.orgId)throw new Error("Select a VigieMail organization");
  if(options.admin&&!session.has({role:"org:admin"}))throw new Error("Workspace administrator role required");
  const [workspace]=await requireDb().select().from(workspaces).where(eq(workspaces.clerkOrganizationId,session.orgId)).limit(1);
  if(!workspace)throw new Error("Workspace has not been provisioned yet");
  return {workspace,userId:session.userId,orgId:session.orgId};
}
