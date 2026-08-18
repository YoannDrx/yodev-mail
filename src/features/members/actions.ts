"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  cancelWorkspaceMemberInvitation,
  inviteWorkspaceMember,
  removeWorkspaceMember,
} from "@/features/members/service";
import { currentWorkspace } from "@/lib/current-workspace";

const idSchema = z.string().trim().min(1).max(128);
const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());

export async function inviteMemberAction(formData: FormData) {
  const email = emailSchema.parse(formData.get("email"));
  const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
  if (workspace.status !== "approved") throw new Error("Le workspace doit être approuvé avant d’inviter un membre.");
  await inviteWorkspaceMember({
    actorUserId: userId,
    db: requireDb(),
    email,
    organizationId: orgId,
    workspaceId: workspace.id,
  });
  revalidatePath("/dashboard/membres");
}

export async function cancelMemberInvitationAction(invitationId: string) {
  const id = idSchema.parse(invitationId);
  const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
  await cancelWorkspaceMemberInvitation({
    actorUserId: userId,
    db: requireDb(),
    invitationId: id,
    organizationId: orgId,
    workspaceId: workspace.id,
  });
  revalidatePath("/dashboard/membres");
}

export async function removeMemberAction(memberId: string) {
  const id = idSchema.parse(memberId);
  const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
  await removeWorkspaceMember({
    actorUserId: userId,
    db: requireDb(),
    memberId: id,
    organizationId: orgId,
    workspaceId: workspace.id,
  });
  revalidatePath("/dashboard/membres");
}
