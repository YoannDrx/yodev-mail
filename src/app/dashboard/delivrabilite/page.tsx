import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { Activity, CheckCircle2, Gauge, ShieldAlert } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Progress } from "@/components/ui/progress";
import { requireDb } from "@/db";
import { domainProviderBindings, domains } from "@/db/schema";
import { getReputationWindow } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

const rate = (value:number,total:number)=>total?value/total*100:0;

export default async function Page(){
  const locale=await getLocale();
  const formatLocale=localeCode(locale);
  const copy=localized(locale,{fr:{title:"Délivrabilité",setup:"Configuration requise.",description:"Authentification, quota Yodev et réputation calculée sur les 30 derniers jours.",activeDomains:"domaines actifs",authentication:"Authentification",accepted:"acceptés",delivered:"délivrés",reputation:"Réputation",stage:"Étape",perDay:"emails/jour",quota:"Quota workspace",noComplaint:"Aucune plainte sur la période",suspended:"Workspace suspendu pour revue",complaints:"Plaintes",thresholds:"Seuils automatiques du workspace",rules:"Toute plainte, trois hard bounces, ou un taux de hard bounce d’au moins 2 % après 50 envois déclenche une pause et une revue manuelle.",domain:"Domaine",lastCheck:"Dernière vérification",pending:"en attente",unknown:"inconnu",never:"Jamais",empty:"Ajoutez un domaine pour démarrer."},en:{title:"Deliverability",setup:"Configuration required.",description:"Authentication, Yodev quota, and reputation calculated over the last 30 days.",activeDomains:"active domains",authentication:"Authentication",accepted:"accepted",delivered:"delivered",reputation:"Reputation",stage:"Stage",perDay:"emails/day",quota:"Workspace quota",noComplaint:"No complaints during this period",suspended:"Workspace paused for review",complaints:"Complaints",thresholds:"Automatic workspace thresholds",rules:"Any complaint, three hard bounces, or a hard-bounce rate of at least 2% after 50 sends triggers a pause and manual review.",domain:"Domain",lastCheck:"Last check",pending:"pending",unknown:"unknown",never:"Never",empty:"Add a domain to get started."}});
  const context=await requirePageWorkspace();
  if(!context)return <DashboardPage description={copy.setup} title={copy.title}><></></DashboardPage>;
  const [reputation,domainRows]=await Promise.all([
    getReputationWindow(context.workspace.id),
    requireDb().select({domain:domains,binding:domainProviderBindings}).from(domains).leftJoin(domainProviderBindings,and(eq(domainProviderBindings.domainId,domains.id),eq(domainProviderBindings.workspaceId,domains.workspaceId),eq(domainProviderBindings.isActive,true))).where(eq(domains.workspaceId,context.workspace.id)),
  ]);
  const bounce=rate(reputation.hardBounces,reputation.accepted);
  const complaint=rate(reputation.complaints,reputation.accepted);
  const verified=domainRows.filter((row)=>row.binding?.status==="verified").length;
  return <DashboardPage description={copy.description} title={copy.title}>
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4"><Card healthy={verified===domainRows.length&&domainRows.length>0} icon={verified===domainRows.length&&domainRows.length?CheckCircle2:ShieldAlert} text={`${verified} / ${domainRows.length} ${copy.activeDomains}`} title={copy.authentication}/><Card healthy={bounce<2&&complaint===0} icon={Activity} text={`${reputation.accepted.toLocaleString(formatLocale)} ${copy.accepted} · ${reputation.delivered.toLocaleString(formatLocale)} ${copy.delivered}`} title={copy.reputation}/><Card healthy={context.workspace.status==="approved"} icon={ShieldAlert} text={`${copy.stage} ${context.workspace.warmupStage} · ${context.workspace.dailyLimit.toLocaleString(formatLocale)} ${copy.perDay}`} title={copy.quota}/><Card healthy={reputation.complaints===0} icon={Gauge} text={reputation.complaints===0?copy.noComplaint:copy.suspended} title={copy.complaints}/></div>
    <section className="mt-6 rounded-2xl border bg-white p-6"><h2 className="font-semibold">{copy.thresholds}</h2><div className="mt-6 grid gap-6 md:grid-cols-2"><Metric label="Hard bounces" locale={formatLocale} pause={2} value={bounce}/><Metric label={copy.complaints} locale={formatLocale} pause={0.001} value={complaint}/></div><p className="mt-5 text-xs text-muted-foreground">{copy.rules}</p></section>
    <div className="mt-6 overflow-x-auto rounded-2xl border bg-white"><table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{[copy.domain,"DKIM","Return-Path","DMARC",copy.lastCheck].map((label)=><th className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{domainRows.map(({domain,binding})=><tr className="border-b last:border-0" key={domain.id}><td className="px-5 py-4 font-medium">{domain.name}</td><td className="px-5 py-4">{binding?.dkimStatus?statusLabel(locale,binding.dkimStatus):copy.pending}</td><td className="px-5 py-4">{binding?.returnPathStatus?statusLabel(locale,binding.returnPathStatus):copy.pending}</td><td className="px-5 py-4">{binding?.dmarcStatus?statusLabel(locale,binding.dmarcStatus):copy.unknown}</td><td className="px-5 py-4 text-muted-foreground">{binding?.lastCheckedAt?new Intl.DateTimeFormat(formatLocale,{dateStyle:"short",timeStyle:"short"}).format(binding.lastCheckedAt):copy.never}</td></tr>)}{!domainRows.length&&<tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>{copy.empty}</td></tr>}</tbody></table></div>
  </DashboardPage>;
}

function Card({healthy,icon:Icon,text,title}:{healthy:boolean;icon:typeof Activity;text:string;title:string}){return <article className="rounded-2xl border bg-white p-6"><Icon className={`size-6 ${healthy?"text-emerald-600":"text-amber-600"}`}/><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p></article>}
function Metric({label,locale,pause,value}:{label:string;locale:string;pause:number;value:number}){return <div><div className="flex justify-between"><span>{label}</span><strong>{new Intl.NumberFormat(locale,{minimumFractionDigits:3,maximumFractionDigits:3}).format(value)} %</strong></div><Progress className="my-3" value={Math.min(100,value/pause*100)}/></div>}
