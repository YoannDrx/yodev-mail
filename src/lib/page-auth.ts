import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { currentWorkspace } from "@/lib/current-workspace";
import { isBetterAuthConfigured } from "@/lib/env";

export async function requirePageUser() {
  if (!isBetterAuthConfigured()) redirect("/connexion?configuration=requise");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user.id) redirect("/connexion");
  return { userId: session.user.id, user: session.user };
}

export async function requirePageWorkspace() {
  await requirePageUser();
  try {
    return await currentWorkspace();
  } catch {
    redirect("/onboarding");
  }
}

export async function requireAdmin() {
  const { user } = await requirePageUser();
  if ((user as { role?: string }).role !== "admin") notFound();
  return { userId: user.id };
}
