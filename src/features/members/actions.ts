"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  actionFailure,
  actionSuccess,
  fieldErrorsFromZod,
  formValues,
  type ActionState,
} from "@/lib/action-state";
import {
  InvitationLinkUnavailableError,
  issueInvitationLink,
} from "@/features/members/invitation-link";
import {
  cancelWorkspaceMemberInvitation,
  inviteWorkspaceMember,
  MemberServiceError,
  removeWorkspaceMember,
  type MemberErrorCode,
} from "@/features/members/service";
import { currentWorkspace, WorkspaceAccessError } from "@/lib/current-workspace";
import { localized, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export type InvitationLink = { url: string; expiresAt: string };
export type MemberActionState = ActionState<{ link?: InvitationLink }>;

const idSchema = z.string().trim().min(1).max(128);

function emailSchema(locale: Locale) {
  return z
    .string({ error: localized(locale, { fr: "Indiquez une adresse email.", en: "Enter an email address." }) })
    .trim()
    .email({ error: localized(locale, { fr: "Indiquez une adresse email valide.", en: "Enter a valid email address." }) })
    .max(320)
    .transform((value) => value.toLowerCase());
}

const serviceMessages: Record<MemberErrorCode, Record<Locale, string>> = {
  workspace_not_approved: { fr: "Le workspace doit être approuvé par Yodev avant d’inviter un membre.", en: "The workspace must be approved by Yodev before inviting a member." },
  already_member: { fr: "Cette adresse appartient déjà au workspace.", en: "This address already belongs to the workspace." },
  seat_limit: { fr: "La limite de membres, invitations en attente incluses, est atteinte.", en: "The member limit, pending invitations included, has been reached." },
  invitation_not_found: { fr: "Invitation introuvable ou déjà traitée.", en: "Invitation not found or already handled." },
  member_not_found: { fr: "Membre introuvable.", en: "Member not found." },
  cannot_remove_self: { fr: "Vous ne pouvez pas vous retirer vous-même du workspace.", en: "You cannot remove yourself from the workspace." },
  cannot_remove_owner: { fr: "Le propriétaire du workspace ne peut pas être retiré.", en: "The workspace owner cannot be removed." },
  member_already_removed: { fr: "Le membre a déjà été retiré.", en: "The member has already been removed." },
};

// Expected refusals become a message on the page; unexpected failures still
// reach the error boundary so they are not silently swallowed.
function refusal<TData>(locale: Locale, error: unknown, values: Record<string, string> = {}): ActionState<TData> {
  unstable_rethrow(error);
  if (error instanceof MemberServiceError) return actionFailure(serviceMessages[error.code][locale], { values });
  if (error instanceof InvitationLinkUnavailableError) {
    return actionFailure(serviceMessages.invitation_not_found[locale], { values });
  }
  if (error instanceof WorkspaceAccessError) {
    return actionFailure(localized(locale, { fr: "Aucun workspace accessible pour ce compte.", en: "No workspace is accessible for this account." }), { values });
  }
  if (error instanceof Error && error.message === "Workspace administrator role required.") {
    return actionFailure(localized(locale, { fr: "Seuls le propriétaire et les administrateurs du workspace peuvent gérer les membres.", en: "Only the workspace owner and administrators can manage members." }), { values });
  }
  if (error instanceof Error && error.message === "Authentication is required.") {
    return actionFailure(localized(locale, { fr: "Votre session a expiré. Reconnectez-vous.", en: "Your session has expired. Please sign in again." }), { values });
  }
  throw error;
}

function linkData(link: { url: string; expiresAt: Date }): { link: InvitationLink } {
  return { link: { url: link.url, expiresAt: link.expiresAt.toISOString() } };
}

export async function inviteMemberAction(_previous: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const locale = await getLocale();
  const values = formValues(formData, ["email"]);
  const parsed = emailSchema(locale).safeParse(formData.get("email"));
  if (!parsed.success) {
    return actionFailure(localized(locale, { fr: "Vérifiez l’adresse saisie.", en: "Check the address you entered." }), {
      fieldErrors: { email: fieldErrorsFromZod(parsed.error)._form },
      values,
    });
  }
  try {
    const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
    if (workspace.status !== "approved") throw new MemberServiceError("workspace_not_approved", "Workspace not approved.");
    const db = requireDb();
    const invitation = await inviteWorkspaceMember({
      actorUserId: userId,
      db,
      email: parsed.data,
      organizationId: orgId,
      workspaceId: workspace.id,
    });
    revalidatePath("/dashboard/membres");
    if (invitation.delivered) {
      return actionSuccess(localized(locale, { fr: "Invitation envoyée par email.", en: "Invitation sent by email." }));
    }
    const link = await issueInvitationLink({
      actorUserId: userId,
      db,
      invitationId: invitation.id,
      issuedBy: "workspace_admin",
      organizationId: orgId,
      workspaceId: workspace.id,
    });
    return actionSuccess(
      localized(locale, {
        fr: "Invitation enregistrée, mais l’email n’a pas pu être envoyé. Copiez le lien ci-dessous et transmettez-le uniquement à la personne invitée : il expire dans 24 heures.",
        en: "Invitation saved, but the email could not be sent. Copy the link below and share it only with the invited person: it expires in 24 hours.",
      }),
      linkData(link),
    );
  } catch (error) {
    return refusal(locale, error, values);
  }
}

export async function copyMemberInvitationLinkAction(_previous: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const locale = await getLocale();
  const parsed = idSchema.safeParse(formData.get("invitationId"));
  if (!parsed.success) return actionFailure(serviceMessages.invitation_not_found[locale]);
  try {
    const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
    const link = await issueInvitationLink({
      actorUserId: userId,
      db: requireDb(),
      invitationId: parsed.data,
      issuedBy: "workspace_admin",
      organizationId: orgId,
      workspaceId: workspace.id,
    });
    revalidatePath("/dashboard/membres");
    return actionSuccess(
      localized(locale, {
        fr: "Lien d’invitation prêt. Transmettez-le uniquement à la personne invitée : il expire dans 24 heures.",
        en: "Invitation link ready. Share it only with the invited person: it expires in 24 hours.",
      }),
      linkData(link),
    );
  } catch (error) {
    return refusal(locale, error);
  }
}

export async function cancelMemberInvitationAction(_previous: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const locale = await getLocale();
  const parsed = idSchema.safeParse(formData.get("invitationId"));
  if (!parsed.success) return actionFailure(serviceMessages.invitation_not_found[locale]);
  try {
    const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
    await cancelWorkspaceMemberInvitation({
      actorUserId: userId,
      db: requireDb(),
      invitationId: parsed.data,
      organizationId: orgId,
      workspaceId: workspace.id,
    });
    revalidatePath("/dashboard/membres");
    return actionSuccess(localized(locale, { fr: "Invitation révoquée.", en: "Invitation revoked." }));
  } catch (error) {
    return refusal(locale, error);
  }
}

export async function removeMemberAction(_previous: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const locale = await getLocale();
  const parsed = idSchema.safeParse(formData.get("memberId"));
  if (!parsed.success) return actionFailure(serviceMessages.member_not_found[locale]);
  try {
    const { workspace, userId, orgId } = await currentWorkspace({ admin: true });
    await removeWorkspaceMember({
      actorUserId: userId,
      db: requireDb(),
      memberId: parsed.data,
      organizationId: orgId,
      workspaceId: workspace.id,
    });
    revalidatePath("/dashboard/membres");
    return actionSuccess(localized(locale, { fr: "Membre retiré du workspace.", en: "Member removed from the workspace." }));
  } catch (error) {
    return refusal(locale, error);
  }
}
