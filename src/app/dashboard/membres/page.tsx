import { and, asc, eq, gt } from "drizzle-orm";
import { UserPlus, Users } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireDb } from "@/db";
import { authInvitations, authMembers, authUsers, workspaces } from "@/db/schema";
import {
  cancelMemberInvitationAction,
  inviteMemberAction,
  removeMemberAction,
} from "@/features/members/actions";
import { workspaceMemberLimit } from "@/features/members/service";
import { requirePageWorkspace } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
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

  return <DashboardPage
    title="Membres"
    description={`${members.length} membre(s) actif(s), ${invitations.length} invitation(s) en attente · ${workspaceMemberLimit} places maximum.`}
    action={<form action={inviteMemberAction} className="flex gap-2">
      <Input aria-label="Email du membre" disabled={seatsUsed >= workspaceMemberLimit} name="email" placeholder="membre@example.com" required type="email" />
      <Button disabled={seatsUsed >= workspaceMemberLimit} type="submit"><UserPlus />Inviter</Button>
    </form>}
  >
    <div className="grid gap-4">
      {members.map((member) => {
        const isOwner = member.role.split(",").map((role) => role.trim()).includes("owner");
        return <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-white p-5" key={member.id}>
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-violet-100 text-primary"><Users className="size-5" /></div>
            <div><p className="font-medium">{member.name}</p><p className="text-sm text-muted-foreground">{member.email}</p></div>
            <Badge variant={isOwner ? "default" : "secondary"}>{isOwner ? "propriétaire" : "membre"}</Badge>
          </div>
          {!isOwner && member.userId !== context.userId && <form action={removeMemberAction.bind(null, member.id)}>
            <Button size="sm" type="submit" variant="destructive">Retirer</Button>
          </form>}
        </article>;
      })}
      {invitations.map((invitation) => <article className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed bg-white p-5" key={invitation.id}>
        <div><p className="font-medium">{invitation.email}</p><p className="text-sm text-muted-foreground">Invitation valable jusqu’au {invitation.expiresAt.toLocaleString("fr-FR")}</p></div>
        <div className="flex items-center gap-2"><Badge variant="outline">en attente</Badge><form action={cancelMemberInvitationAction.bind(null, invitation.id)}><Button size="sm" type="submit" variant="outline">Annuler</Button></form></div>
      </article>)}
    </div>
  </DashboardPage>;
}
