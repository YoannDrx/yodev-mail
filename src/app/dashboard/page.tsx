import Link from "next/link";
import { Activity, ArrowUpRight, MailCheck, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { getDashboardData } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";

const percent = (value: number, total: number) => total > 0 ? (value / total) * 100 : 0;
const rate = (value: number) => `${value.toFixed(2).replace(".", ",")} %`;

export default async function Dashboard() {
  const context = await requirePageWorkspace();
  if (!context) return <section className="rounded-3xl border bg-white p-10 text-center"><h1 className="text-3xl font-semibold">Cockpit Mail by Yodev</h1><p className="mt-3 text-muted-foreground">Configurez Clerk pour créer un workspace.</p></section>;
  const data = await getDashboardData(context.workspace.id);
  const deliveredRate = percent(data.totals.delivered, data.totals.accepted);
  const complaintRate = percent(data.totals.complaints, data.totals.accepted);
  const bounceRate = percent(data.totals.hardBounces, data.totals.accepted);
  const maxDay = Math.max(1, ...data.activity.map((day) => day.acceptedEmails));
  const healthy = data.totals.complaints === 0 && data.totals.hardBounces < 3 && bounceRate < 2;
  return <>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" }).format(new Date())}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.workspace.name}</h1><p className="mt-2 text-muted-foreground">Envois transactionnels, réputation et garde-fous du workspace.</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link href="/dashboard/profils">Déclarer un cas d’usage</Link></Button><Button asChild><Link href="/dashboard/domaines">Ajouter un domaine</Link></Button></div></div>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Acceptés ce mois" value={data.currentMonthAccepted.toLocaleString("fr-FR")} detail="Base de facturation" icon={Send}/><StatCard label="Délivrés sur 30 jours" value={rate(deliveredRate)} detail={`${data.totals.delivered.toLocaleString("fr-FR")} confirmations`} icon={MailCheck}/><StatCard label="En attente" value={String((data.statusCounts.queued ?? 0)+(data.statusCounts.sending ?? 0))} detail="Queue et envois en cours" icon={Activity}/><StatCard label="Réputation" value={healthy?"Saine":"À revoir"} detail={`${rate(complaintRate)} de plaintes`} icon={healthy?ShieldCheck:TriangleAlert}/></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]"><section className="rounded-2xl border bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="font-semibold">Activité transactionnelle</h2><p className="text-sm text-muted-foreground">30 derniers jours</p></div><Badge variant="secondary">Acceptés</Badge></div>{data.activity.length?<div className="mt-8 flex h-52 items-end gap-2">{data.activity.map((day)=><div className="min-h-1 flex-1 rounded-t-sm bg-gradient-to-t from-blue-700 to-blue-300" key={day.day} style={{height:`${Math.max(2,percent(day.acceptedEmails,maxDay))}%`}} title={`${day.day}: ${day.acceptedEmails}`}/>)}</div>:<div className="mt-8 grid h-52 place-items-center rounded-xl bg-zinc-50 text-sm text-muted-foreground">Aucun envoi réel sur cette période.</div>}</section><section className="rounded-2xl border bg-white p-6 shadow-sm"><h2 className="font-semibold">Garde-fous</h2><div className="mt-6 grid gap-6"><Metric label="Quota quotidien" value={`${data.todayAccepted.toLocaleString("fr-FR")} / ${data.workspace.dailyLimit.toLocaleString("fr-FR")}`} progress={percent(data.todayAccepted,data.workspace.dailyLimit)}/><Metric label="Hard bounces" value={`${rate(bounceRate)} / 2 %`} progress={percent(bounceRate,2)}/><Metric label="Plaintes" value={`${data.totals.complaints} / 0 tolérée`} progress={data.totals.complaints?100:0}/></div><div className={`mt-7 rounded-xl p-4 text-sm ${healthy?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900"}`}><Activity className="mr-2 inline size-4"/>{healthy?"Tous les indicateurs mesurés sont sains.":"Une revue manuelle est nécessaire."}</div></section></div>
    <section className="mt-6 rounded-2xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">Derniers messages</h2><p className="text-sm text-muted-foreground">Catégorie et statut Yodev</p></div><Button asChild variant="ghost"><Link href="/dashboard/emails">Tout voir <ArrowUpRight/></Link></Button></div>{data.recentMessages.length?data.recentMessages.map((message)=><div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b px-5 py-4 last:border-0 sm:grid-cols-3" key={message.id}><span className="font-medium">{message.category}</span><Badge variant="secondary">{message.status}</Badge><span className="hidden text-sm text-muted-foreground sm:block">{new Intl.DateTimeFormat("fr-FR",{dateStyle:"short",timeStyle:"short"}).format(message.createdAt)}</span></div>):<p className="p-8 text-center text-sm text-muted-foreground">Aucun message créé.</p>}</section>
  </>;
}

function Metric({label,progress,value}:{label:string;progress:number;value:string}){return <div><div className="mb-2 flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">{value}</span></div><Progress value={Math.min(100,progress)}/></div>}
