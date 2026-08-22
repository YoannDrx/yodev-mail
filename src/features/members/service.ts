import "server-only";

import { randomUUID } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import {
  auditEvents,
  authInvitations,
  authMembers,
  authOrganizations,
  authUsers,
  workspaces,
} from "@/db/schema";
import { sendAuthEmail } from "@/lib/auth-emails";
import { env } from "@/lib/env";
import { planCatalog } from "@/lib/plans";

type Database = ReturnType<typeof requireDb>;

export const workspaceMemberLimit = planCatalog.beta.members;

function invitationUrl(invitationId: string) {
  const baseUrl = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/fr/invitation?id=${encodeURIComponent(invitationId)}`;
}

export async function inviteWorkspaceMember(input: {
  actorUserId: string;
  db: Database;
  email: string;
  organizationId: string;
  workspaceId: string;
}) {
  const email = input.email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 48 * 60 * 60_000);
  const invitation = await input.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select ${authOrganizations.id}
      from ${authOrganizations}
      inner join ${workspaces}
        on ${workspaces.authOrganizationId} = ${authOrganizations.id}
      where ${authOrganizations.id} = ${input.organizationId}
        and ${workspaces.id} = ${input.workspaceId}
        and ${workspaces.status} = 'approved'
      for update
    `);
    if (!locked.rowCount) throw new Error("An approved workspace linked to Better Auth is required.");

    const [existingMember] = await tx
      .select({ id: authMembers.id })
      .from(authMembers)
      .innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
      .where(and(
        eq(authMembers.organizationId, input.organizationId),
        sql`lower(${authUsers.email}) = ${email}`,
      ))
      .limit(1);
    if (existingMember) throw new Error("Cette adresse appartient déjà au workspace.");

    const [existingInvitation] = await tx
      .select({ id: authInvitations.id })
      .from(authInvitations)
      .where(and(
        eq(authInvitations.organizationId, input.organizationId),
        eq(authInvitations.status, "pending"),
        sql`lower(${authInvitations.email}) = ${email}`,
      ))
      .limit(1);
    if (existingInvitation) {
      await tx.update(authInvitations).set({ expiresAt }).where(and(
        eq(authInvitations.id, existingInvitation.id),
        eq(authInvitations.organizationId, input.organizationId),
        eq(authInvitations.status, "pending"),
      ));
      return { id: existingInvitation.id, created: false };
    }

    const now = new Date();
    const [[members], [pendingInvitations]] = await Promise.all([
      tx.select({ total: count() }).from(authMembers).where(eq(authMembers.organizationId, input.organizationId)),
      tx.select({ total: count() }).from(authInvitations).where(and(
        eq(authInvitations.organizationId, input.organizationId),
        eq(authInvitations.status, "pending"),
        gt(authInvitations.expiresAt, now),
      )),
    ]);
    if (members.total + pendingInvitations.total >= workspaceMemberLimit) {
      throw new Error(`La limite de ${workspaceMemberLimit} membres, invitations en attente incluses, est atteinte.`);
    }

    const id = randomUUID();
    await tx.insert(authInvitations).values({
      id,
      organizationId: input.organizationId,
      email,
      role: "member",
      status: "pending",
      expiresAt,
      inviterId: input.actorUserId,
    });
    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.member_invitation_created",
      entityType: "auth_invitation",
      entityId: id,
      metadata: { role: "member" },
    });
    return { id, created: true };
  });

  try {
    await sendAuthEmail({
      actionUrl: invitationUrl(invitation.id),
      intro: "Vous êtes invité à rejoindre votre workspace Mail by Yodev.",
      kind: "organization_invitation",
      to: email,
    });
    await input.db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.member_invitation_sent",
      entityType: "auth_invitation",
      entityId: invitation.id,
      metadata: { role: "member", resent: !invitation.created },
    });
  } catch {
    await input.db.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.member_invitation_delivery_failed",
      entityType: "auth_invitation",
      entityId: invitation.id,
      metadata: { errorCode: "invitation_delivery_failed" },
    });
    throw new Error("L’invitation est enregistrée, mais son email n’a pas pu être envoyé. Vous pouvez la renvoyer.");
  }
  return invitation;
}

export async function cancelWorkspaceMemberInvitation(input: {
  actorUserId: string;
  db: Database;
  invitationId: string;
  organizationId: string;
  workspaceId: string;
}) {
  await input.db.transaction(async (tx) => {
    const canceled = await tx.update(authInvitations).set({ status: "canceled" }).where(and(
      eq(authInvitations.id, input.invitationId),
      eq(authInvitations.organizationId, input.organizationId),
      eq(authInvitations.status, "pending"),
      sql`exists(select 1 from ${workspaces} where ${workspaces.id} = ${input.workspaceId} and ${workspaces.authOrganizationId} = ${input.organizationId})`,
    )).returning({ id: authInvitations.id });
    if (!canceled.length) throw new Error("Invitation introuvable ou déjà traitée.");
    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.member_invitation_canceled",
      entityType: "auth_invitation",
      entityId: input.invitationId,
    });
  });
}

export async function removeWorkspaceMember(input: {
  actorUserId: string;
  db: Database;
  memberId: string;
  organizationId: string;
  workspaceId: string;
}) {
  await input.db.transaction(async (tx) => {
    const [target] = await tx.select({ role: authMembers.role, userId: authMembers.userId }).from(authMembers)
      .innerJoin(workspaces, and(
        eq(workspaces.id, input.workspaceId),
        eq(workspaces.authOrganizationId, authMembers.organizationId),
      ))
      .where(and(
        eq(authMembers.id, input.memberId),
        eq(authMembers.organizationId, input.organizationId),
      ))
      .limit(1);
    if (!target) throw new Error("Membre introuvable.");
    if (target.userId === input.actorUserId) throw new Error("Vous ne pouvez pas vous retirer vous-même du workspace.");
    if (target.role.split(",").map((role) => role.trim()).includes("owner")) {
      throw new Error("Le propriétaire du workspace ne peut pas être retiré.");
    }
    const removed = await tx.delete(authMembers).where(and(
      eq(authMembers.id, input.memberId),
      eq(authMembers.organizationId, input.organizationId),
    )).returning({ id: authMembers.id });
    if (!removed.length) throw new Error("Le membre a déjà été retiré.");
    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.member_removed",
      entityType: "auth_member",
      entityId: input.memberId,
    });
  });
}
