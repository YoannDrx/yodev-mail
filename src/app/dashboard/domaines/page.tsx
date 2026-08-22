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
import { localized } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, { fr: { title: "Domaines", description: "Ajoutez le domaine réel de l’application ; Yodev prépare ensuite les enregistrements DNS.", domain: "Domaine", add: "Ajouter", review: "en revue", operated: "Le service de livraison est sélectionné et opéré par Yodev.", recheck: "Revérifier", pending: "en attente", records: "Enregistrements DNS à configurer", dnsPending: "La vérification DNS n’est pas encore terminée.", empty: "Ajoutez votre premier domaine ; aucun compte fournisseur n’est nécessaire." }, en: { title: "Domains", description: "Add the application’s actual domain; Yodev then prepares the DNS records.", domain: "Domain", add: "Add", review: "under review", operated: "The delivery provider is selected and operated by Yodev.", recheck: "Check again", pending: "pending", records: "DNS records to configure", dnsPending: "DNS verification is not complete yet.", empty: "Add your first domain; no provider account is required." } });
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
    <DashboardPage title={copy.title} description={copy.description} action={<form action={addDomainAction} className="flex gap-2"><Input aria-label={copy.domain} name="domain" placeholder="notifications.client.com" required /><Button type="submit"><Plus />{copy.add}</Button></form>}>
      <div className="grid gap-5">
        {rows.map(({ domain, binding }) => (
          <article className="rounded-2xl border bg-white shadow-sm" key={domain.id}>
            <div className="flex flex-col justify-between gap-4 border-b p-6 sm:flex-row">
              <div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{domain.name}</h2><Badge variant={binding?.status === "verified" ? "default" : binding?.status === "failed" ? "destructive" : "secondary"}>{binding?.status ? statusLabel(locale,binding.status) : copy.review}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{copy.operated}</p></div>
              <form action={refreshDomainAction.bind(null, domain.id)}><Button type="submit" variant="outline"><RefreshCw />{copy.recheck}</Button></form>
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-3">{[["DKIM", binding?.dkimStatus], ["Return-Path", binding?.returnPathStatus], ["DMARC", binding?.dmarcStatus]].map(([label, status]) => <div className="rounded-xl border p-4" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 flex items-center gap-2 font-medium ${status === "verified" ? "text-emerald-700" : "text-amber-700"}`}>{status === "verified" ? <CheckCircle2 className="size-4" /> : <ShieldAlert className="size-4" />}{status ? statusLabel(locale,status) : copy.pending}</p></div>)}</div>
            <div className="border-t p-6"><h3 className="font-medium">{copy.records}</h3><div className="mt-3 grid gap-2">{(binding?.dnsRecords ?? []).map((record, index) => <div className="grid gap-1 rounded-lg bg-zinc-50 p-3 font-mono text-xs sm:grid-cols-[70px_1fr_1.5fr]" key={`${record.name}-${index}`}><strong>{record.type}</strong><span className="break-all">{record.name}</span><span className="break-all text-muted-foreground">{record.value}</span></div>)}</div>{binding?.lastCheckError && <p className="mt-3 text-sm text-destructive">{copy.dnsPending}</p>}</div>
          </article>
        ))}
        {!rows.length && <div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">{copy.empty}</div>}
      </div>
    </DashboardPage>
  );
}
