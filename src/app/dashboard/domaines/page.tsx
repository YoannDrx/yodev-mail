import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { CheckCircle2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireDb } from "@/db";
import { domainProviderBindings, domains } from "@/db/schema";
import { addDomainAction, refreshDomainAction } from "@/features/domains/actions";
import { requirePageWorkspace } from "@/lib/page-auth";

export default async function Page() {
  const context = await requirePageWorkspace();
  const [domainRows, bindings] = context ? await Promise.all([
    requireDb().select().from(domains).where(eq(domains.workspaceId, context.workspace.id)).orderBy(desc(domains.createdAt)),
    requireDb().select().from(domainProviderBindings).where(eq(domainProviderBindings.workspaceId, context.workspace.id)).orderBy(desc(domainProviderBindings.createdAt)),
  ]) : [[], []];
  const rows = domainRows.map((domain) => ({
    domain,
    binding: bindings.find((binding) => binding.domainId === domain.id && binding.isActive)
      ?? bindings.find((binding) => binding.domainId === domain.id),
  }));
  return (
    <DashboardPage title="Domaines" description="Ajoutez le domaine réel de l’application ; Yodev prépare ensuite les enregistrements DNS." action={<form action={addDomainAction} className="flex gap-2"><Input aria-label="Domaine" name="domain" placeholder="notifications.client.fr" required /><Button type="submit"><Plus />Ajouter</Button></form>}>
      <div className="grid gap-5">
        {rows.map(({ domain, binding }) => (
          <article className="rounded-2xl border bg-white shadow-sm" key={domain.id}>
            <div className="flex flex-col justify-between gap-4 border-b p-6 sm:flex-row">
              <div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{domain.name}</h2><Badge variant={binding?.status === "verified" ? "default" : binding?.status === "failed" ? "destructive" : "secondary"}>{binding?.status ?? "en revue"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">Le service de livraison est sélectionné et opéré par Yodev.</p></div>
              <form action={refreshDomainAction.bind(null, domain.id)}><Button type="submit" variant="outline"><RefreshCw />Revérifier</Button></form>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-3">{[["DKIM", binding?.dkimStatus], ["Return-Path", binding?.returnPathStatus], ["DMARC", binding?.dmarcStatus]].map(([label, status]) => <div className="rounded-xl border p-4" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 flex items-center gap-2 font-medium ${status === "verified" ? "text-emerald-700" : "text-amber-700"}`}>{status === "verified" ? <CheckCircle2 className="size-4" /> : <ShieldAlert className="size-4" />}{status ?? "en attente"}</p></div>)}</div>
            <div className="border-t p-6"><h3 className="font-medium">Enregistrements DNS à configurer</h3><div className="mt-3 grid gap-2">{(binding?.dnsRecords ?? []).map((record, index) => <div className="grid gap-1 rounded-lg bg-zinc-50 p-3 font-mono text-xs sm:grid-cols-[70px_1fr_1.5fr]" key={`${record.name}-${index}`}><strong>{record.type}</strong><span className="break-all">{record.name}</span><span className="break-all text-muted-foreground">{record.value}</span></div>)}</div>{binding?.lastCheckError && <p className="mt-3 text-sm text-destructive">La vérification DNS n’est pas encore terminée.</p>}</div>
          </article>
        ))}
        {!rows.length && <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">Ajoutez votre premier domaine ; aucun compte fournisseur n’est nécessaire.</div>}
      </div>
    </DashboardPage>
  );
}
