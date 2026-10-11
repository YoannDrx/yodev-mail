import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { requireDb } from "@/db";
import { domainProviderBindings, domains } from "@/db/schema";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { AddDomainForm, RecheckDomainButton } from "./domain-forms";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Domaines", en: "Domains" }) };
}

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, { fr: { title: "Domaines", description: "Ajoutez le domaine réel de l’application ; Yodev prépare ensuite les enregistrements DNS.", review: "en revue", operated: "Le service de livraison est sélectionné et opéré par Yodev.", pending: "en attente", records: "Enregistrements DNS à configurer", recordsPending: "Yodev prépare les enregistrements DNS de ce domaine. Ils apparaîtront ici.", dnsPending: "La vérification DNS n’est pas encore terminée.", empty: "Ajoutez votre premier domaine ; aucun compte fournisseur n’est nécessaire.", type: "Type", name: "Nom", value: "Valeur" }, en: { title: "Domains", description: "Add the application’s actual domain; Yodev then prepares the DNS records.", review: "under review", operated: "The delivery provider is selected and operated by Yodev.", pending: "pending", records: "DNS records to configure", recordsPending: "Yodev is preparing this domain’s DNS records. They will appear here.", dnsPending: "DNS verification is not complete yet.", empty: "Add your first domain; no provider account is required.", type: "Type", name: "Name", value: "Value" } });
  const context = await requirePageWorkspace();
  const canManage = ["owner", "admin"].includes(context.role);
  const [domainRows, bindings] = await Promise.all([
    requireDb().select().from(domains).where(eq(domains.workspaceId, context.workspace.id)).orderBy(desc(domains.createdAt)),
    requireDb().select().from(domainProviderBindings).where(eq(domainProviderBindings.workspaceId, context.workspace.id)).orderBy(desc(domainProviderBindings.createdAt)),
  ]);
  const rows = domainRows.map((domain) => ({
    domain,
    binding: bindings.find((binding) => binding.domainId === domain.id && binding.isActive)
      ?? bindings.find((binding) => binding.domainId === domain.id),
  }));
  return (
    <DashboardPage title={copy.title} description={copy.description} action={<AddDomainForm canManage={canManage} locale={locale} />}>
      <div className="grid gap-5">
        {rows.map(({ domain, binding }) => (
          <article className="rounded-md border bg-card " key={domain.id}>
            <div className="flex flex-col justify-between gap-4 border-b p-6 sm:flex-row">
              <div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{domain.name}</h2><Badge variant={binding?.status === "verified" ? "default" : binding?.status === "failed" ? "destructive" : "secondary"}>{binding?.status ? statusLabel(locale,binding.status) : copy.review}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{copy.operated}</p></div>
              <RecheckDomainButton canManage={canManage} domainId={domain.id} locale={locale} provisioned={Boolean(binding)} />
            </div>
            <div className="grid gap-4 p-6 sm:grid-cols-3">{[["DKIM", binding?.dkimStatus], ["Return-Path", binding?.returnPathStatus], ["DMARC", binding?.dmarcStatus]].map(([label, status]) => <div className="rounded-md border p-4" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 flex items-center gap-2 font-medium ${status === "verified" ? "text-[var(--y-success)]" : "text-[var(--y-warning)]"}`}>{status === "verified" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <ShieldAlert aria-hidden="true" className="size-4" />}{status ? statusLabel(locale,status) : copy.pending}</p></div>)}</div>
            <div className="border-t p-6"><h3 className="font-medium">{copy.records}</h3>
              {binding?.dnsRecords.length ? <div className="mt-3 grid gap-2">{binding.dnsRecords.map((record, index) => <dl className="grid gap-1 rounded-lg bg-muted p-3 font-mono text-xs sm:grid-cols-[70px_1fr_1.5fr]" key={`${record.name}-${index}`}><dt className="sr-only">{copy.type}</dt><dd><strong>{record.type}</strong></dd><dt className="sr-only">{copy.name}</dt><dd className="break-all">{record.name}</dd><dt className="sr-only">{copy.value}</dt><dd className="break-all text-muted-foreground">{record.value}</dd></dl>)}</div> : <p className="mt-2 text-sm text-muted-foreground">{copy.recordsPending}</p>}
              {binding?.lastCheckError && <p className="mt-3 text-sm text-destructive">{copy.dnsPending}</p>}
            </div>
          </article>
        ))}
        {!rows.length && <div className="rounded-md border border-dashed p-12 text-center text-sm text-muted-foreground">{copy.empty}</div>}
      </div>
    </DashboardPage>
  );
}
