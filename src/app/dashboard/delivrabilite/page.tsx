import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { Activity, CheckCircle2, Gauge, ShieldAlert } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Progress } from "@/components/ui/progress";
import { requireDb } from "@/db";
import { domainProviderBindings, domains } from "@/db/schema";
import { getReputationWindow } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";

const rate = (value:number,total:number)=>total?value/total*100:0;

export default async function Page(){
  const context=await requirePageWorkspace();
  if(!context)return <DashboardPage description="Configuration requise." title="Délivrabilité"><></></DashboardPage>;
  const [reputation,domainRows]=await Promise.all([
    getReputationWindow(context.workspace.id),
    requireDb().select({domain:domains,binding:domainProviderBindings}).from(domains).leftJoin(domainProviderBindings,and(eq(domainProviderBindings.domainId,domains.id),eq(domainProviderBindings.workspaceId,domains.workspaceId),eq(domainProviderBindings.isActive,true))).where(eq(domains.workspaceId,context.workspace.id)),
  ]);
  const bounce=rate(reputation.hardBounces,reputation.accepted);
  const complaint=rate(reputation.complaints,reputation.accepted);
  const verified=domainRows.filter((row)=>row.binding?.status==="verified").length;
  return <DashboardPage description="Authentification, quota Yodev et réputation calculée sur les 30 derniers jours." title="Délivrabilité">
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4"><Card healthy={verified===domainRows.length&&domainRows.length>0} icon={verified===domainRows.length&&domainRows.length?CheckCircle2:ShieldAlert} text={`${verified} / ${domainRows.length} domaines actifs`} title="Authentification"/><Card healthy={bounce<2&&complaint===0} icon={Activity} text={`${reputation.accepted.toLocaleString("fr-FR")} acceptés · ${reputation.delivered.toLocaleString("fr-FR")} délivrés`} title="Réputation"/><Card healthy={context.workspace.status==="approved"} icon={ShieldAlert} text={`Étape ${context.workspace.warmupStage} · ${context.workspace.dailyLimit.toLocaleString("fr-FR")} emails/jour`} title="Quota workspace"/><Card healthy={reputation.complaints===0} icon={Gauge} text={reputation.complaints===0?"Aucune plainte sur la période":"Workspace suspendu pour revue"} title="Plaintes"/></div>
    <section className="mt-6 rounded-2xl border bg-white p-6"><h2 className="font-semibold">Seuils automatiques du workspace</h2><div className="mt-6 grid gap-6 md:grid-cols-2"><Metric label="Hard bounces" pause={2} value={bounce}/><Metric label="Plaintes" pause={0.001} value={complaint}/></div><p className="mt-5 text-xs text-muted-foreground">Toute plainte, trois hard bounces, ou un taux de hard bounce d’au moins 2 % après 50 envois déclenche une pause et une revue manuelle.</p></section>
    <div className="mt-6 overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{["Domaine","DKIM","Return-Path","DMARC","Dernière vérification"].map((label)=><th className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{domainRows.map(({domain,binding})=><tr className="border-b last:border-0" key={domain.id}><td className="px-5 py-4 font-medium">{domain.name}</td><td className="px-5 py-4">{binding?.dkimStatus??"en attente"}</td><td className="px-5 py-4">{binding?.returnPathStatus??"en attente"}</td><td className="px-5 py-4">{binding?.dmarcStatus??"inconnu"}</td><td className="px-5 py-4 text-muted-foreground">{binding?.lastCheckedAt?new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(binding.lastCheckedAt):"Jamais"}</td></tr>)}{!domainRows.length&&<tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>Ajoutez un domaine pour démarrer.</td></tr>}</tbody></table></div>
  </DashboardPage>;
}

function Card({healthy,icon:Icon,text,title}:{healthy:boolean;icon:typeof Activity;text:string;title:string}){return <article className="rounded-2xl border bg-white p-6"><Icon className={`size-6 ${healthy?"text-emerald-600":"text-amber-600"}`}/><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p></article>}
function Metric({label,pause,value}:{label:string;pause:number;value:number}){return <div><div className="flex justify-between"><span>{label}</span><strong>{value.toFixed(3).replace(".",",")} %</strong></div><Progress className="my-3" value={Math.min(100,value/pause*100)}/></div>}
