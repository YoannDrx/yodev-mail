import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import { safeRedirectPath } from "@/lib/auth-policy";
import {
  BootstrapWorkspaceAmbiguousError,
  currentWorkspace,
  WorkspaceAccessError,
} from "@/lib/current-workspace";
import { isBetterAuthConfigured } from "@/lib/env";
import { localizedPath } from "@/i18n/config";
import { getLocale, getOriginalPathname } from "@/i18n/server";

// One session lookup per request, shared by the layout, navigation and page.
const pageSession = cache(async () => getAuth().api.getSession({ headers: await headers() }));

async function signInPath() {
  const locale = await getLocale();
  const requested = safeRedirectPath(await getOriginalPathname(), "");
  const path = localizedPath(locale, "/connexion");
  return requested ? `${path}?next=${encodeURIComponent(requested)}` : path;
}

export async function requirePageUser() {
  const locale = await getLocale();
  if (!isBetterAuthConfigured()) redirect(`${localizedPath(locale, "/connexion")}?configuration=requise`);
  const session = await pageSession();
  if (!session?.user.id) redirect(await signInPath());
  return { userId: session.user.id, user: session.user };
}

/** Signed-in user, if any, without redirecting (sign-in and invitation pages). */
export async function optionalPageUser() {
  if (!isBetterAuthConfigured()) return null;
  const session = await pageSession();
  return session?.user.id ? session.user : null;
}

export async function requirePageWorkspace() {
  const locale = await getLocale();
  await requirePageUser();
  try {
    return await currentWorkspace();
  } catch (error) {
    if (error instanceof BootstrapWorkspaceAmbiguousError) {
      redirect(`${localizedPath(locale, "/connexion")}?erreur=bootstrap`);
    }
    if (error instanceof WorkspaceAccessError) redirect(localizedPath(locale, "/onboarding"));
    throw error;
  }
}

/** Platform role read from the database-backed session (never from the client). */
export async function isPlatformAdmin() {
  if (!isBetterAuthConfigured()) return false;
  const session = await pageSession();
  return (session?.user as { role?: string } | undefined)?.role === "admin";
}

export async function requireAdmin() {
  const { user } = await requirePageUser();
  if ((user as { role?: string }).role !== "admin") notFound();
  return { userId: user.id };
}
