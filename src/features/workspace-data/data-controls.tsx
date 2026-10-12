"use client";

import { deleteAccountAction, deleteWorkspaceAction } from "@/features/workspace-data/actions";
import { TypedConfirmationDialog } from "@/features/workspace-data/typed-confirmation-dialog";
import { localized, type Locale } from "@/i18n/config";

export function DeleteWorkspaceControl({ locale, workspaceName }: { locale: Locale; workspaceName: string }) {
  const copy = localized(locale, {
    fr: {
      trigger: "Supprimer le workspace",
      title: `Supprimer définitivement « ${workspaceName} » ?`,
      description: "Les clés API sont révoquées, les membres perdent l’accès et toutes les données du workspace (domaines, modèles, historique d’envoi, suppressions) sont effacées. Cette action est irréversible : exportez vos données avant.",
      field: `Saisissez « ${workspaceName} » pour confirmer`,
      account: "Supprimer aussi mon compte (si je ne suis propriétaire d’aucun autre workspace)",
      confirm: "Supprimer définitivement",
      pending: "Suppression…",
      cancel: "Annuler",
    },
    en: {
      trigger: "Delete workspace",
      title: `Permanently delete “${workspaceName}”?`,
      description: "API keys are revoked, members lose access and all workspace data (domains, templates, sending history, suppressions) is erased. This cannot be undone: export your data first.",
      field: `Type “${workspaceName}” to confirm`,
      account: "Also delete my account (if I own no other workspace)",
      confirm: "Delete permanently",
      pending: "Deleting…",
      cancel: "Cancel",
    },
  });
  return (
    <TypedConfirmationDialog
      action={deleteWorkspaceAction}
      cancelLabel={copy.cancel}
      confirmLabel={copy.confirm}
      description={copy.description}
      expected={workspaceName}
      fieldLabel={copy.field}
      fieldName="confirmationName"
      pendingLabel={copy.pending}
      title={copy.title}
      trigger={copy.trigger}
    >
      <label className="flex gap-3 text-sm leading-6">
        <input className="mt-1" name="deleteAccount" type="checkbox" />
        <span>{copy.account}</span>
      </label>
    </TypedConfirmationDialog>
  );
}

export function DeleteAccountControl({ locale, email }: { locale: Locale; email: string }) {
  const copy = localized(locale, {
    fr: {
      trigger: "Supprimer mon compte",
      title: "Supprimer définitivement votre compte ?",
      description: "Vos sessions, méthodes de connexion et passkeys sont supprimées et vous quittez ce workspace. Le workspace et ses données restent à son propriétaire.",
      field: `Saisissez votre adresse (${email}) pour confirmer`,
      confirm: "Supprimer mon compte",
      pending: "Suppression…",
      cancel: "Annuler",
    },
    en: {
      trigger: "Delete my account",
      title: "Permanently delete your account?",
      description: "Your sessions, sign-in methods and passkeys are deleted and you leave this workspace. The workspace and its data remain with its owner.",
      field: `Type your email address (${email}) to confirm`,
      confirm: "Delete my account",
      pending: "Deleting…",
      cancel: "Cancel",
    },
  });
  return (
    <TypedConfirmationDialog
      action={deleteAccountAction}
      cancelLabel={copy.cancel}
      caseInsensitive
      confirmLabel={copy.confirm}
      description={copy.description}
      expected={email}
      fieldLabel={copy.field}
      fieldName="confirmationEmail"
      pendingLabel={copy.pending}
      title={copy.title}
      trigger={copy.trigger}
    />
  );
}
