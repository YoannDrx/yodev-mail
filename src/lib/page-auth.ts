import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { currentWorkspace } from "@/lib/current-workspace";
import { isBetterAuthConfigured } from "@/lib/env";
import { localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function requirePageUser() {
  const locale = await getLocale();
  if (!isBetterAuthConfigured()) redirect(`${localizedPath(locale, "/connexion")}?configuration=requise`);
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session?.user.id) redirect(localizedPath(locale, "/connexion"));
  return { userId: session.user.id, user: session.user };
}

export async function requirePageWorkspace() {
  const locale = await getLocale();
  await requirePageUser();
  try {
    return await currentWorkspace();
  } catch {
    redirect(localizedPath(locale, "/onboarding"));
  }
}

export async function requireAdmin() {
  const { user } = await requirePageUser();
  if ((user as { role?: string }).role !== "admin") notFound();
  return { userId: user.id };
}
