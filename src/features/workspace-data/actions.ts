"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionState, actionFailure } from "@/lib/action-state";
import { currentWorkspace } from "@/lib/current-workspace";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import {
  type AccountDeletionRefusal,
  deleteUserAccount,
  requestWorkspaceDeletion,
  type WorkspaceDeletionRefusal,
} from "@/features/workspace-data/deletion";

async function clearAuthCookies() {
  const jar = await cookies();
  for (const cookie of jar.getAll()) {
    if (cookie.name.includes("yodev_mail.")) jar.delete(cookie.name);
  }
}

function hasRole(role: string, expected: string) {
  return role.split(",").map((value) => value.trim()).includes(expected);
}

/**
 * Owner-only: delete the current workspace (field `confirmationName` must be
 * the workspace name). With `deleteAccount=on`, the owner's account is
 * deleted afterwards when they belong to no other workspace as owner.
 */
export async function deleteWorkspaceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: {
      not_found: "Ce workspace n’existe plus.",
      not_owner: "Seul le propriétaire du workspace peut le supprimer.",
      confirmation_mismatch: "Le nom saisi ne correspond pas au nom du workspace.",
      subscription_active: "Un abonnement est encore actif : résiliez-le depuis la page Facturation, puis réessayez à la fin de la période.",
      messages_in_flight: "Des emails sont encore en file d’envoi. Réessayez dans quelques minutes.",
      usage_unreported: "La consommation des dernières heures n’est pas encore transmise à Stripe. Réessayez dans une heure.",
    } satisfies Record<WorkspaceDeletionRefusal, string>,
    en: {
      not_found: "This workspace no longer exists.",
      not_owner: "Only the workspace owner can delete it.",
      confirmation_mismatch: "The name you typed does not match the workspace name.",
      subscription_active: "A subscription is still active: cancel it from the Billing page, then try again after the period ends.",
      messages_in_flight: "Some emails are still queued for sending. Try again in a few minutes.",
      usage_unreported: "Usage from the last few hours has not been sent to Stripe yet. Try again in an hour.",
    } satisfies Record<WorkspaceDeletionRefusal, string>,
  });
  const context = await currentWorkspace({ admin: true });
  if (!hasRole(context.role, "owner")) return actionFailure(copy.not_owner);
  const confirmationName = z.string().max(200).safeParse(formData.get("confirmationName"));
  if (!confirmationName.success) return actionFailure(copy.confirmation_mismatch);
  const result = await requestWorkspaceDeletion({
    workspaceId: context.workspace.id,
    organizationId: context.orgId,
    actorUserId: context.userId,
    confirmationName: confirmationName.data,
  });
  if (result.status === "refused") {
    return actionFailure(copy[result.reason], { fieldErrors: result.reason === "confirmation_mismatch" ? { confirmationName: [copy.confirmation_mismatch] } : {} });
  }
  let accountKept = "";
  if (formData.get("deleteAccount") === "on") {
    // The owner already confirmed by typing the workspace name.
    const account = await deleteUserAccount({ userId: context.userId, confirmationEmail: null });
    if (account.status === "deleted") {
      await clearAuthCookies();
      redirect(`${localizedPath(locale, "/")}?compte=supprime`);
    }
    accountKept = "&compte=conserve";
  }
  redirect(`${localizedPath(locale, "/onboarding")}?workspace=supprime${accountKept}`);
}

/**
 * Self-service deletion of the signed-in account (field `confirmationEmail`
 * must be the account email). Refused while the user owns a workspace.
 */
export async function deleteAccountAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: {
      not_found: "Ce compte n’existe plus.",
      confirmation_mismatch: "L’adresse saisie ne correspond pas à celle de votre compte.",
      owns_workspace: "Vous êtes propriétaire d’un workspace : supprimez-le ou transférez-le avant de supprimer votre compte.",
      platform_admin: "Un compte administrateur Yodev ne peut pas être supprimé depuis la console.",
    } satisfies Record<AccountDeletionRefusal, string>,
    en: {
      not_found: "This account no longer exists.",
      confirmation_mismatch: "The address you typed does not match your account email.",
      owns_workspace: "You own a workspace: delete or transfer it before deleting your account.",
      platform_admin: "A Yodev administrator account cannot be deleted from the console.",
    } satisfies Record<AccountDeletionRefusal, string>,
  });
  const context = await currentWorkspace();
  const confirmationEmail = z.string().max(320).safeParse(formData.get("confirmationEmail"));
  if (!confirmationEmail.success) return actionFailure(copy.confirmation_mismatch);
  const result = await deleteUserAccount({ userId: context.userId, confirmationEmail: confirmationEmail.data });
  if (result.status === "refused") {
    return actionFailure(copy[result.reason], { fieldErrors: result.reason === "confirmation_mismatch" ? { confirmationEmail: [copy.confirmation_mismatch] } : {} });
  }
  await clearAuthCookies();
  redirect(`${localizedPath(locale, "/")}?compte=supprime`);
}
