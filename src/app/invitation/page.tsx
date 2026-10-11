import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { BrandMark } from "@/components/brand-mark";
import { InvitationPanel, type InvitationState } from "@/components/auth/invitation-panel";
import { SignInProblemNotice } from "@/components/auth/sign-in-problem";
import { requireDb } from "@/db";
import { authInvitations, authOrganizations, workspaces } from "@/db/schema";
import { signInProblem } from "@/lib/auth-policy";
import { isDatabaseConfigured } from "@/lib/env";
import { optionalPageUser } from "@/lib/page-auth";
import { localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getLocale()) === "fr" ? "Invitation à rejoindre un workspace" : "Workspace invitation",
    robots: { index: false, follow: false },
  };
}

// Shows enough to recognise the address without disclosing it in full.
function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}${"*".repeat(Math.min(Math.max(local.length - 1, 2), 6))}@${domain}`;
}

async function loadInvitation(id: string) {
  if (!isDatabaseConfigured()) return null;
  const [invitation] = await requireDb()
    .select({
      email: authInvitations.email,
      expiresAt: authInvitations.expiresAt,
      organizationName: authOrganizations.name,
      status: authInvitations.status,
    })
    .from(authInvitations)
    .innerJoin(authOrganizations, eq(authOrganizations.id, authInvitations.organizationId))
    .innerJoin(workspaces, and(
      eq(workspaces.authOrganizationId, authInvitations.organizationId),
      isNull(workspaces.deletedAt),
    ))
    .where(eq(authInvitations.id, id))
    .limit(1);
  return invitation ?? null;
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const id = typeof params.id === "string" ? params.id : undefined;
  if (!id || id.length < 20 || id.length > 128) notFound();
  const locale = await getLocale();
  const problem = signInProblem({ error: params.error, erreur: params.erreur });
  const [invitation, user] = await Promise.all([loadInvitation(id), optionalPageUser()]);

  let state: InvitationState;
  if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date()) state = "unavailable";
  else if (!user) state = "anonymous";
  else if (user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase()) state = "mismatch";
  else state = "ready";

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href={localizedPath(locale, "/")}><BrandMark className="text-xl" /></Link>
        {problem ? <SignInProblemNotice locale={locale} problem={problem} /> : null}
        <InvitationPanel
          invitationId={id}
          invitedEmail={state === "mismatch" && invitation ? maskEmail(invitation.email) : undefined}
          locale={locale}
          organizationName={state === "unavailable" ? undefined : invitation?.organizationName}
          signedInEmail={state === "mismatch" ? user?.email : undefined}
          state={state}
        />
      </div>
    </main>
  );
}
