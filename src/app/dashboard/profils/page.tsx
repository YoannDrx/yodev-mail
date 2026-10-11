import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { requireDb } from "@/db";
import { transactionalProfiles } from "@/db/schema";
import { ConfirmAction } from "@/components/confirm-action";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { disableTransactionalProfileAction } from "@/features/profiles/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Cas d’usage", en: "Use cases" }) };
}

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { title: "Cas d’usage transactionnels", description: "Chaque catégorie décrit un événement applicatif précis et doit être validée par Yodev avant un envoi live.", disable: "Désactiver", confirmTitle: "Désactiver ce cas d’usage ?", confirmText: "Les envois de cette catégorie seront refusés. Une réactivation nécessitera une nouvelle validation par Yodev.", confirm: "Désactiver le cas d’usage", pending: "Désactivation…", cancel: "Annuler", empty: "Aucun cas d’usage déclaré." },
    en: { title: "Transactional use cases", description: "Each category describes a specific application event and must be approved by Yodev before live sending.", disable: "Disable", confirmTitle: "Disable this use case?", confirmText: "Sends in this category will be refused. Reactivation requires a new review by Yodev.", confirm: "Disable use case", pending: "Disabling…", cancel: "Cancel", empty: "No use case declared yet." },
  });
  const context = await requirePageWorkspace();
  const canManage = ["owner", "admin"].includes(context.role);
  const rows = await requireDb().select().from(transactionalProfiles).where(eq(transactionalProfiles.workspaceId, context.workspace.id)).orderBy(desc(transactionalProfiles.createdAt));
  return <DashboardPage title={copy.title} description={copy.description}>
    <ProfileForm canManage={canManage} locale={locale} />
    <div className="grid gap-4">{rows.map((profile) => <article className="rounded-md border bg-card p-5" key={profile.id}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-3"><h2 className="font-semibold">{profile.name}</h2><Badge variant="secondary">{statusLabel(locale, profile.status)}</Badge></div><p className="mt-1 font-mono text-xs text-muted-foreground">{profile.key}</p></div>
        {profile.status !== "disabled" && canManage && <ConfirmAction action={disableTransactionalProfileAction.bind(null, profile.id)} cancelLabel={copy.cancel} confirmLabel={copy.confirm} description={copy.confirmText} pendingLabel={copy.pending} title={copy.confirmTitle} trigger={copy.disable} />}
      </div>
      <p className="mt-4 text-sm">{profile.triggerDescription}</p><p className="mt-2 text-sm text-muted-foreground">{profile.recipientRelationship}</p>
    </article>)}
    {!rows.length && <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.empty}</p>}
    </div>
  </DashboardPage>;
}
