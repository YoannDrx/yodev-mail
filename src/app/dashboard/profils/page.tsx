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

export default async function Page() {
  const context = await requirePageWorkspace();
  const rows = context ? await requireDb().select().from(transactionalProfiles).where(eq(transactionalProfiles.workspaceId, context.workspace.id)).orderBy(desc(transactionalProfiles.createdAt)) : [];
  return <DashboardPage title="Cas d’usage transactionnels" description="Chaque catégorie décrit un événement applicatif précis et doit être validée par Yodev avant un envoi live.">
    <form action={createTransactionalProfileAction} className="mb-8 grid gap-5 rounded-2xl border bg-white p-6 md:grid-cols-2">
      <div className="grid gap-2"><Label htmlFor="key">Clé API</Label><Input id="key" name="key" placeholder="payment_receipt" required /></div>
      <div className="grid gap-2"><Label htmlFor="name">Nom</Label><Input id="name" name="name" placeholder="Reçu de paiement" required /></div>
      <div className="grid gap-2"><Label htmlFor="expectedMonthlyVolume">Volume mensuel estimé</Label><Input id="expectedMonthlyVolume" name="expectedMonthlyVolume" type="number" min="1" required /></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="triggerDescription">Événement déclencheur</Label><Textarea id="triggerDescription" name="triggerDescription" required /></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="recipientRelationship">Relation avec le destinataire</Label><Textarea id="recipientRelationship" name="recipientRelationship" required /></div>
      <div className="grid gap-2 md:col-span-2"><Label htmlFor="contentExample">Exemple de contenu</Label><Textarea id="contentExample" name="contentExample" required /></div>
      <Button className="w-fit" type="submit">Soumettre à validation</Button>
    </form>
    <div className="grid gap-4">{rows.map((profile) => <article className="rounded-2xl border bg-white p-5" key={profile.id}>
      <div className="flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-3"><h2 className="font-semibold">{profile.name}</h2><Badge variant="secondary">{profile.status}</Badge></div><p className="mt-1 font-mono text-xs text-muted-foreground">{profile.key}</p></div>{profile.status !== "disabled" && <form action={disableTransactionalProfileAction.bind(null, profile.id)}><Button type="submit" size="sm" variant="outline">Désactiver</Button></form>}</div>
      <p className="mt-4 text-sm">{profile.triggerDescription}</p><p className="mt-2 text-sm text-muted-foreground">{profile.recipientRelationship}</p>
    </article>)}</div>
  </DashboardPage>;
}
