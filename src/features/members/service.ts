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
import { planCatalog } from "@/lib/plans";
import { invitationUrl } from "@/features/members/invitation-link";

type Database = ReturnType<typeof requireDb>;

export const workspaceMemberLimit = planCatalog.beta.members;

export type MemberErrorCode =
  | "workspace_not_approved"
  | "already_member"
  | "seat_limit"
  | "invitation_not_found"
  | "member_not_found"
  | "cannot_remove_self"
  | "cannot_remove_owner"
  | "member_already_removed";

/** An expected refusal the interface explains; anything else is a failure. */
export class MemberServiceError extends Error {
  constructor(readonly code: MemberErrorCode, message: string) {
    super(message);
    this.name = "MemberServiceError";
  }
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
    if (!locked.rowCount) {
      throw new MemberServiceError("workspace_not_approved", "An approved workspace linked to Better Auth is required.");
    }

    const [existingMember] = await tx
      .select({ id: authMembers.id })
      .from(authMembers)
      .innerJoin(authUsers, eq(authUsers.id, authMembers.userId))
      .where(and(
        eq(authMembers.organizationId, input.organizationId),
        sql`lower(${authUsers.email}) = ${email}`,
      ))
      .limit(1);
    if (existingMember) throw new MemberServiceError("already_member", "Cette adresse appartient déjà au workspace.");

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
      throw new MemberServiceError("seat_limit", `La limite de ${workspaceMemberLimit} membres, invitations en attente incluses, est atteinte.`);
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

  let delivered = true;
  try {
    await sendAuthEmail({
      actionUrl: invitationUrl(invitation.id),
      intro: "Vous êtes invité à rejoindre votre workspace Mail by Yodev.",
      kind: "organization_invitation",
      to: email,
    });
  } catch {
    delivered = false;
  }
  // The invitation is recorded either way: when the system email is off or
  // fails, the caller offers the audited copy-link fallback instead.
  await input.db.insert(auditEvents).values({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    action: delivered ? "workspace.member_invitation_sent" : "workspace.member_invitation_delivery_failed",
    entityType: "auth_invitation",
    entityId: invitation.id,
    metadata: delivered
      ? { role: "member", resent: !invitation.created }
      : { errorCode: "invitation_delivery_failed" },
  });
  return { ...invitation, delivered };
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
    if (!canceled.length) throw new MemberServiceError("invitation_not_found", "Invitation introuvable ou déjà traitée.");
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
    if (!target) throw new MemberServiceError("member_not_found", "Membre introuvable.");
    if (target.userId === input.actorUserId) {
      throw new MemberServiceError("cannot_remove_self", "Vous ne pouvez pas vous retirer vous-même du workspace.");
    }
    if (target.role.split(",").map((role) => role.trim()).includes("owner")) {
      throw new MemberServiceError("cannot_remove_owner", "Le propriétaire du workspace ne peut pas être retiré.");
    }
    const removed = await tx.delete(authMembers).where(and(
      eq(authMembers.id, input.memberId),
      eq(authMembers.organizationId, input.organizationId),
    )).returning({ id: authMembers.id });
    if (!removed.length) throw new MemberServiceError("member_already_removed", "Le membre a déjà été retiré.");
    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.member_removed",
      entityType: "auth_member",
      entityId: input.memberId,
    });
  });
}
