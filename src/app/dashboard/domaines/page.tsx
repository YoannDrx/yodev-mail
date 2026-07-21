import { desc, eq } from "drizzle-orm";
import { CheckCircle2, Plus, RefreshCw, ShieldAlert } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireDb } from "@/db";
import { domains } from "@/db/schema";
import { addDomainAction, refreshDomainAction } from "@/features/domains/actions";
import { requirePageWorkspace } from "@/lib/page-auth";

export default async function Page() {
  const context = await requirePageWorkspace();
  const rows = context ? await requireDb().select().from(domains).where(eq(domains.workspaceId, context.workspace.id)).orderBy(desc(domains.createdAt)) : [];
  return <DashboardPage title="Domaines" description="Identités Easy DKIM, MAIL FROM et diagnostic DMARC isolés par workspace." action={<form action={addDomainAction} className="flex gap-2"><Input aria-label="Domaine" name="domain" placeholder="client.fr" required /><Button type="submit"><Plus />Ajouter</Button></form>}>
    <div className="grid gap-5">{rows.map((domain)=><article className="rounded-2xl border bg-white shadow-sm" key={domain.id}><div className="flex flex-col justify-between gap-4 border-b p-6 sm:flex-row"><div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">{domain.name}</h2><Badge variant={domain.status==="verified"?"default":domain.status==="failed"?"destructive":"secondary"}>{domain.status}</Badge></div><p className="mt-2 text-sm text-muted-foreground">MAIL FROM : {domain.mailFromDomain}</p></div><form action={refreshDomainAction.bind(null,domain.id)}><Button type="submit" variant="outline"><RefreshCw />Revérifier</Button></form></div><div className="grid gap-4 p-6 sm:grid-cols-3">{[["DKIM",domain.dkimStatus],["MAIL FROM",domain.mailFromStatus],["DMARC",domain.dmarcStatus]].map(([label,status])=><div className="rounded-xl border p-4" key={label}><p className="text-xs text-muted-foreground">{label}</p><p className={`mt-2 flex items-center gap-2 font-medium ${status==="verified"?"text-emerald-700":"text-amber-700"}`}>{status==="verified"?<CheckCircle2 className="size-4"/>:<ShieldAlert className="size-4"/>}{status}</p></div>)}</div><div className="border-t p-6"><h3 className="font-medium">Enregistrements DNS</h3><div className="mt-3 grid gap-2">{domain.dnsRecords.map((record,index)=><div className="grid gap-1 rounded-lg bg-zinc-50 p-3 font-mono text-xs sm:grid-cols-[70px_1fr_1.5fr]" key={`${record.name}-${index}`}><strong>{record.type}</strong><span className="break-all">{record.name}</span><span className="break-all text-muted-foreground">{record.value}</span></div>)}</div>{domain.lastCheckError&&<p className="mt-3 text-sm text-destructive">{domain.lastCheckError}</p>}</div></article>)}{!rows.length&&<div className="rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">Ajoutez votre premier domaine pour générer les DNS SES.</div>}</div>
  </DashboardPage>;
}
