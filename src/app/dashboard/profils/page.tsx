import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { requireDb } from "@/db";
import { transactionalProfiles } from "@/db/schema";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTransactionalProfileAction, disableTransactionalProfileAction } from "@/features/profiles/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, { fr: { title: "Cas d’usage transactionnels", description: "Chaque catégorie décrit un événement applicatif précis et doit être validée par Yodev avant un envoi live.", key: "Clé API", name: "Nom", namePlaceholder: "Reçu de paiement", volume: "Volume mensuel estimé", trigger: "Événement déclencheur", relationship: "Relation avec le destinataire", content: "Exemple de contenu", submit: "Soumettre à validation", disable: "Désactiver" }, en: { title: "Transactional use cases", description: "Each category describes a specific application event and must be approved by Yodev before live sending.", key: "API key", name: "Name", namePlaceholder: "Payment receipt", volume: "Estimated monthly volume", trigger: "Triggering event", relationship: "Relationship with the recipient", content: "Content example", submit: "Submit for review", disable: "Disable" } });
  const context = await requirePageWorkspace();
  const rows = context ? await requireDb().select().from(transactionalProfiles).where(eq(transactionalProfiles.workspaceId, context.workspace.id)).orderBy(desc(transactionalProfiles.createdAt)) : [];
  return <DashboardPage title={copy.title} description={copy.description}>
    <form action={createTransactionalProfileAction} className="mb-8 grid gap-5 rounded-2xl border bg-white p-6 md:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="key">{copy.key}</Label><Input id="key" name="key" placeholder="payment_receipt" required /></div>
      <div className="grid gap-2"><Label htmlFor="name">{copy.name}</Label><Input id="name" name="name" placeholder={copy.namePlaceholder} required /></div>
      <div className="grid gap-2"><Label htmlFor="expectedMonthlyVolume">{copy.volume}</Label><Input id="expectedMonthlyVolume" name="expectedMonthlyVolume" type="number" min="1" required /></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="triggerDescription">{copy.trigger}</Label><Textarea id="triggerDescription" name="triggerDescription" required /></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="recipientRelationship">{copy.relationship}</Label><Textarea id="recipientRelationship" name="recipientRelationship" required /></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="contentExample">{copy.content}</Label><Textarea id="contentExample" name="contentExample" required /></div>
      <Button className="w-fit" type="submit">{copy.submit}</Button>
    </form>
    <div className="grid gap-4">{rows.map((profile) => <article className="rounded-2xl border bg-white p-5" key={profile.id}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-3"><h2 className="font-semibold">{profile.name}</h2><Badge variant="secondary">{statusLabel(locale, profile.status)}</Badge></div><p className="mt-1 font-mono text-xs text-muted-foreground">{profile.key}</p></div>{profile.status !== "disabled" && <form action={disableTransactionalProfileAction.bind(null, profile.id)}><Button type="submit" size="sm" variant="outline">{copy.disable}</Button></form>}</div>
      <p className="mt-4 text-sm">{profile.triggerDescription}</p><p className="mt-2 text-sm text-muted-foreground">{profile.recipientRelationship}</p>
    </article>)}</div>
  </DashboardPage>;
}
