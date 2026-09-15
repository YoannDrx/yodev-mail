import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import { localizedPath, type Locale } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";

/** Setup evidence only; the sending policy remains the authority for each delivery. */
export function SetupChecklist({locale,setup,workspaceStatus,billingStatus}:{locale:Locale;setup:{domainVerified:boolean;profileApproved:boolean};workspaceStatus:string;billingStatus:string}) {
  const fr=locale==="fr";
  const steps=[
    {title:fr?"Domaine expéditeur":"Sending domain",ready:setup.domainVerified,detail:setup.domainVerified?(fr?"Domaine vérifié":"Verified domain"):(fr?"Vérification DNS nécessaire":"DNS verification required"),path:"/dashboard/domaines"},
    {title:fr?"Cas d’usage":"Use case",ready:setup.profileApproved,detail:setup.profileApproved?(fr?"Cas d’usage approuvé":"Approved use case"):(fr?"Déclaration et validation nécessaires":"Declaration and approval required"),path:"/dashboard/profils"},
    {title:fr?"Espace de travail":"Workspace",ready:workspaceStatus==="approved",detail:statusLabel(locale,workspaceStatus),path:"/dashboard/parametres"},
    {title:fr?"Abonnement":"Subscription",ready:["active","trialing"].includes(billingStatus),detail:statusLabel(locale,billingStatus),path:"/dashboard/facturation"},
  ];
  return <section className="mt-6 border bg-card p-5" aria-labelledby="setup-title"><h2 id="setup-title" className="font-semibold">{fr?"Préparer les premiers envois":"Prepare your first sends"}</h2><p className="mt-1 text-sm text-muted-foreground">{fr?"Les étapes de configuration de votre application. Chaque envoi reste soumis aux vérifications du service.":"Your application’s setup steps. Each send remains subject to service checks."}</p><ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{steps.map(step=><li key={step.path}><Link href={localizedPath(locale,step.path)} className="flex h-full items-start gap-3 border p-3 text-sm hover:bg-muted">{step.ready?<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--y-success)]"/>:<Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground"/>}<span className="flex-1"><strong className="block font-medium">{step.title}</strong><span className="mt-1 block text-xs text-muted-foreground">{step.detail}</span></span><ArrowUpRight className="size-4 shrink-0"/></Link></li>)}</ol></section>;
}
