import { count, desc, eq } from "drizzle-orm";
import { ListPlus, Plus } from "lucide-react";
import { ContactImportForm } from "@/components/contact-import-form";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireDb } from "@/db";
import { contactListMembers, contactLists, contacts, importJobs } from "@/db/schema";
import { createContactAction, createContactListAction } from "@/features/contacts/actions";
import { requirePageWorkspace } from "@/lib/page-auth";

export default async function Page() {
  const context = await requirePageWorkspace();
  const workspaceId = context?.workspace.id;
  const [rows, lists, imports] = workspaceId
    ? await (async () => {
        const db = requireDb();
        return Promise.all([
        db.select().from(contacts).where(eq(contacts.workspaceId, workspaceId)).orderBy(desc(contacts.createdAt)).limit(200),
        db
          .select({ id: contactLists.id, name: contactLists.name, description: contactLists.description, members: count(contactListMembers.contactId) })
          .from(contactLists)
          .leftJoin(contactListMembers, eq(contactListMembers.listId, contactLists.id))
          .where(eq(contactLists.workspaceId, workspaceId))
          .groupBy(contactLists.id)
          .orderBy(desc(contactLists.createdAt)),
        db.select().from(importJobs).where(eq(importJobs.workspaceId, workspaceId)).orderBy(desc(importJobs.createdAt)).limit(10),
        ]);
      })()
    : [[], [], []];

  return (
    <DashboardPage description="Consentements, listes et imports strictement isolés dans ce workspace." title="Contacts">
      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        <form action={createContactAction} className="grid gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-4">
          <div className="grid gap-2"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
          <div className="grid gap-2"><Label htmlFor="firstName">Prénom</Label><Input id="firstName" name="firstName" /></div>
          <div className="grid gap-2"><Label htmlFor="lastName">Nom</Label><Input id="lastName" name="lastName" /></div>
          <div className="grid gap-2"><Label htmlFor="company">Société</Label><Input id="company" name="company" /></div>
          <div className="grid gap-2 md:col-span-2"><Label htmlFor="consentSource">Source / preuve</Label><Input id="consentSource" name="consentSource" placeholder="Formulaire newsletter du 21/07/2026" /></div>
          <div className="grid gap-2"><Label htmlFor="legalBasis">Base légale</Label><select className="h-9 rounded-md border bg-transparent px-3 text-sm" id="legalBasis" name="legalBasis"><option value="">Non déclarée</option><option value="consent">Consentement</option><option value="existing_customer">Client existant</option><option value="legitimate_interest">Intérêt légitime B2B</option></select></div>
          <div className="grid gap-2"><Label htmlFor="listId">Liste</Label><select className="h-9 rounded-md border bg-transparent px-3 text-sm" id="listId" name="listId"><option value="">Aucune</option>{lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}</select></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input name="marketingConsent" type="checkbox" /> Consentement marketing</label>
          <Button className="md:col-span-4 md:w-fit" type="submit"><Plus />Ajouter le contact</Button>
        </form>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Listes statiques</h2>
          <form action={createContactListAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input name="name" placeholder="Clients Yodev" required />
            <Button type="submit" variant="outline"><ListPlus />Créer</Button>
            <Input className="sm:col-span-2" name="description" placeholder="Description facultative" />
          </form>
          <div className="mt-5 grid gap-2">
            {lists.map((list) => <div className="flex items-center justify-between rounded-xl border px-4 py-3" key={list.id}><div><p className="text-sm font-medium">{list.name}</p><p className="text-xs text-muted-foreground">{list.description ?? "Liste statique"}</p></div><Badge variant="secondary">{list.members} contacts</Badge></div>)}
            {!lists.length && <p className="py-4 text-sm text-muted-foreground">Aucune liste pour le moment.</p>}
          </div>
        </section>
      </div>

      {workspaceId && <div className="mt-6"><ContactImportForm lists={lists.map(({ id, name }) => ({ id, name }))} /></div>}

      {imports.length > 0 && (
        <section className="mt-6 overflow-x-auto rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-5 py-4"><h2 className="font-semibold">Imports récents</h2></div>
          <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{["Date", "Statut", "Traitées", "Importées", "Rejetées"].map((label) => <th className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{imports.map((job) => <tr className="border-b last:border-0" key={job.id}><td className="px-5 py-4">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(job.createdAt)}</td><td className="px-5 py-4"><Badge variant={job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge></td><td className="px-5 py-4">{job.processedRows}</td><td className="px-5 py-4">{job.importedRows}</td><td className="px-5 py-4">{job.rejectedRows}</td></tr>)}</tbody></table>
        </section>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{["Contact", "Email", "Société", "Base légale", "Consentement", "Statut"].map((label) => <th className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr className="border-b last:border-0" key={row.id}><td className="px-5 py-4">{[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}</td><td className="px-5 py-4">{row.email}</td><td className="px-5 py-4">{row.company ?? "—"}</td><td className="px-5 py-4">{row.legalBasis ?? "—"}</td><td className="px-5 py-4"><Badge variant={row.marketingConsent ? "default" : "secondary"}>{row.marketingConsent ? "Oui" : "Non"}</Badge></td><td className="px-5 py-4"><Badge variant="secondary">{row.status}</Badge></td></tr>)}{!rows.length && <tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={6}>Aucun contact enregistré.</td></tr>}</tbody></table>
      </div>
    </DashboardPage>
  );
}
