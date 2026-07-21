import "server-only";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { env, isClerkConfigured } from "@/lib/env";
import { currentWorkspace } from "@/lib/current-workspace";
export async function requirePageUser(){if(!isClerkConfigured())return {userId:"demo_user"};const session=await auth();if(!session.userId)redirect("/connexion");return {userId:session.userId}}
export async function requirePageWorkspace(){
  if(!isClerkConfigured())return null;
  const session=await auth();
  if(!session.userId)redirect("/connexion");
  if(!session.orgId)redirect("/onboarding");
  return currentWorkspace();
}
export async function requireAdmin(){const {userId}=await requirePageUser();if(userId==="demo_user")return {userId};const admins=new Set((env.ADMIN_USER_IDS??"").split(",").filter(Boolean));if(!admins.has(userId))notFound();return {userId}}
