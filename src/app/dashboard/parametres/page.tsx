import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Button } from "@/components/ui/button";
import { requireDb } from "@/db";
import { workspaceSettings } from "@/db/schema";
import { SettingsForm } from "@/features/settings/settings-form";
import { DeleteAccountControl, DeleteWorkspaceControl } from "@/features/workspace-data/data-controls";
import { requirePageUser, requirePageWorkspace } from "@/lib/page-auth";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocale()) === "fr" ? "Paramètres" : "Settings" };
}

const hasRole = (role: string, expected: string) => role.split(",").map((value) => value.trim()).includes(expected);

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: {
      title: "Paramètres",
      description: "Identité de l’expéditeur, confidentialité et données du workspace.",
      privacy: "Confidentialité",
      privacyText: "Mail by Yodev n’insère aucun pixel de suivi et ne réécrit aucun lien : les ouvertures et les clics ne sont jamais mesurés, quel que soit le destinataire.",
      data: "Vos données",
      exportTitle: "Exporter le workspace",
      exportText: "Un fichier JSON avec le workspace, ses membres, domaines, profils, modèles, consommation, suppressions encore lisibles et l’historique d’envoi conservé (sans le contenu des messages). Les secrets, empreintes de clés API et identifiants techniques des fournisseurs n’y figurent jamais.",
      exportAction: "Télécharger l’export",
      ownerOnly: "Seul le propriétaire du workspace peut l’exporter ou le supprimer.",
      deleteTitle: "Supprimer le workspace",
      deleteText: "Résiliez d’abord l’abonnement depuis la page Facturation. La suppression révoque les clés API, retire l’accès à tous les membres puis efface les données.",
      account: "Votre compte",
      accountOwner: "Vous êtes propriétaire de ce workspace. Pour supprimer votre compte, supprimez d’abord le workspace : la confirmation propose de supprimer votre compte en même temps.",
      accountText: "Supprimer votre compte vous retire de ce workspace et efface vos sessions et méthodes de connexion.",
    },
    en: {
      title: "Settings",
      description: "Sender identity, privacy and workspace data.",
      privacy: "Privacy",
      privacyText: "Mail by Yodev inserts no tracking pixel and rewrites no links: opens and clicks are never measured, for any recipient.",
      data: "Your data",
      exportTitle: "Export the workspace",
      exportText: "A JSON file with the workspace, its members, domains, profiles, templates, usage, still-readable suppressions and the retained sending history (without message content). Secrets, API key hashes and provider technical identifiers are never included.",
      exportAction: "Download the export",
      ownerOnly: "Only the workspace owner can export or delete it.",
      deleteTitle: "Delete the workspace",
      deleteText: "Cancel the subscription from the Billing page first. Deletion revokes API keys, removes access for every member, then erases the data.",
      account: "Your account",
      accountOwner: "You own this workspace. To delete your account, delete the workspace first: the confirmation offers to delete your account at the same time.",
      accountText: "Deleting your account removes you from this workspace and erases your sessions and sign-in methods.",
    },
  });
  const context = await requirePageWorkspace();
  const { user } = await requirePageUser();
  const isOwner = hasRole(context.role, "owner");
  const canEdit = isOwner || hasRole(context.role, "admin");
  const [settings] = await requireDb()
    .select({
      companyName: workspaceSettings.companyName,
      companyAddress: workspaceSettings.companyAddress,
      defaultFromName: workspaceSettings.defaultFromName,
      defaultReplyTo: workspaceSettings.defaultReplyTo,
    })
    .from(workspaceSettings)
    .where(eq(workspaceSettings.workspaceId, context.workspace.id))
    .limit(1);
  return (
    <DashboardPage title={copy.title} description={copy.description}>
      <div className="grid gap-6">
        <SettingsForm
          canEdit={canEdit}
          locale={locale}
          settings={settings ?? { companyName: null, companyAddress: null, defaultFromName: null, defaultReplyTo: null }}
        />
        <section className="rounded-md border bg-card p-6">
          <h2 className="font-semibold">{copy.privacy}</h2>
          <p className="mt-3 text-sm text-muted-foreground">{copy.privacyText}</p>
        </section>
        <section className="rounded-md border bg-card p-6" aria-labelledby="workspace-data-title">
          <h2 className="font-semibold" id="workspace-data-title">{copy.data}</h2>
          {isOwner ? (
            <div className="mt-4 grid gap-6">
              <div className="grid gap-3">
                <h3 className="text-sm font-medium">{copy.exportTitle}</h3>
                <p className="text-sm text-muted-foreground">{copy.exportText}</p>
                <Button asChild className="w-fit" variant="outline">
                  <a download href={localizedPath(locale, "/dashboard/parametres/export")}>
                    <Download aria-hidden="true" />
                    {copy.exportAction}
                  </a>
                </Button>
              </div>
              <div className="grid gap-3 border-t pt-6">
                <h3 className="text-sm font-medium">{copy.deleteTitle}</h3>
                <p className="text-sm text-muted-foreground">{copy.deleteText}</p>
                <div><DeleteWorkspaceControl locale={locale} workspaceName={context.workspace.name} /></div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{copy.ownerOnly}</p>
          )}
        </section>
        <section className="rounded-md border bg-card p-6">
          <h2 className="font-semibold">{copy.account}</h2>
          {isOwner ? (
            <p className="mt-3 text-sm text-muted-foreground">{copy.accountOwner}</p>
          ) : (
            <div className="mt-3 grid gap-3">
              <p className="text-sm text-muted-foreground">{copy.accountText}</p>
              <div><DeleteAccountControl email={user.email} locale={locale} /></div>
            </div>
          )}
        </section>
      </div>
    </DashboardPage>
  );
}
