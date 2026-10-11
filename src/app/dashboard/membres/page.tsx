import type { Metadata } from "next";
import { and, asc, eq, gt } from "drizzle-orm";
import { DashboardPage } from "@/components/dashboard-page";
import { requireDb } from "@/db";
import { authInvitations, authMembers, authUsers, workspaces } from "@/db/schema";
import { workspaceMemberLimit } from "@/features/members/service";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { localeCode } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { MembersPanel } from "./members-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocale()) === "fr" ? "Membres" : "Members" };
}

function hasRole(role: string, expected: string) {
  return role.split(",").map((value) => value.trim()).includes(expected);
}

export default async function MembersPage() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, { fr: { title: "Membres", active: "membre(s) actif(s)", pending: "invitation(s) en attente", max: "places maximum" }, en: { title: "Members", active: "active member(s)", pending: "pending invitation(s)", max: "maximum seats" } });
  const context = await requirePageWorkspace();
  const db = requireDb();
  const [members, invitations] = await Promise.all([
    db.select({
      createdAt: authMembers.createdAt,
      email: authUsers.email,
      id: authMembers.id,
      name: authUsers.name,
      role: authMembers.role,
      userId: authMembers.userId,
    }).from(authMembers)
      .innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
      .innerJoin(workspaces, and(
        eq(workspaces.id, context.workspace.id),
        eq(workspaces.authOrganizationId, authMembers.organizationId),
      ))
      .where(eq(authMembers.organizationId, context.orgId))
      .orderBy(asc(authMembers.createdAt)),
    db.select({
      email: authInvitations.email,
      expiresAt: authInvitations.expiresAt,
      id: authInvitations.id,
      role: authInvitations.role,
    }).from(authInvitations)
      .innerJoin(workspaces, and(
        eq(workspaces.id, context.workspace.id),
        eq(workspaces.authOrganizationId, authInvitations.organizationId),
      ))
      .where(and(
        eq(authInvitations.organizationId, context.orgId),
        eq(authInvitations.status, "pending"),
        gt(authInvitations.expiresAt, new Date()),
      ))
      .orderBy(asc(authInvitations.createdAt)),
  ]);
  const seatsUsed = members.length + invitations.length;
  // Mirrors currentWorkspace({ admin: true }), which the actions re-check.
  const canManage = hasRole(context.role, "owner") || hasRole(context.role, "admin");

  return <DashboardPage
    title={copy.title}
    description={`${members.length} ${copy.active}, ${invitations.length} ${copy.pending} · ${workspaceMemberLimit} ${copy.max}.`}
  >
    <MembersPanel
      canManage={canManage}
      invitations={invitations.map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        validUntil: invitation.expiresAt.toLocaleString(formatLocale, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris", timeZoneName: "short" }),
      }))}
      locale={locale}
      members={members.map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        isOwner: hasRole(member.role, "owner"),
        isSelf: member.userId === context.userId,
      }))}
      seatsFull={seatsUsed >= workspaceMemberLimit}
      workspaceApproved={context.workspace.status === "approved"}
    />
  </DashboardPage>;
}
