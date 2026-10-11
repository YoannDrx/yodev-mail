import type { Metadata } from "next";
import Link from "next/link";
import { SetupChecklist } from "@/components/setup-checklist";
import { Activity, ArrowUpRight, MailCheck, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireDb } from "@/db";
import { getDashboardData } from "@/features/dashboard/queries";
import { getActivationEvidence } from "@/features/onboarding/activation";
import { dateTimeFormatter } from "@/lib/date-time";
import { isFeatureEnabled } from "@/lib/env";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized, localizedPath } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

const percent = (value: number, total: number) => total > 0 ? (value / total) * 100 : 0;

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Vue d’ensemble", en: "Overview" }) };
}

export default async function Dashboard() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const rate = (value: number) => `${new Intl.NumberFormat(formatLocale, { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value)} %`;
  const href = (path: string) => localizedPath(locale, path);
  const copy = localized(locale, {
    fr: { intro: "Envois transactionnels, réputation et garde-fous du workspace.", declare: "Déclarer un cas d’usage", addDomain: "Ajouter un domaine", acceptedMonth: "Acceptés ce mois", billingBase: "Base de facturation", delivered30: "Délivrés sur 30 jours", confirmations: "confirmations", pending: "En attente", queue: "Queue et envois en cours", reputation: "Réputation", healthy: "Saine", review: "À revoir", complaints: "de plaintes", activity: "Activité transactionnelle", last30: "30 derniers jours", accepted: "Acceptés", noSend: "Aucun envoi réel sur cette période.", safeguards: "Garde-fous", quota: "Quota quotidien", complaint: "Plaintes", tolerated: "tolérée", allHealthy: "Tous les indicateurs mesurés sont sains.", manual: "Une revue manuelle est nécessaire.", recent: "Derniers messages", day: "Jour", categoryStatus: "Catégorie et statut Yodev", all: "Tout voir", noMessage: "Aucun message créé." },
    en: { intro: "Transactional sends, reputation, and workspace safeguards.", declare: "Declare a use case", addDomain: "Add a domain", acceptedMonth: "Accepted this month", billingBase: "Billing basis", delivered30: "Delivered over 30 days", confirmations: "confirmations", pending: "Pending", queue: "Queued and sending", reputation: "Reputation", healthy: "Healthy", review: "Review needed", complaints: "complaints", activity: "Transactional activity", last30: "Last 30 days", accepted: "Accepted", noSend: "No live sends during this period.", safeguards: "Safeguards", quota: "Daily quota", complaint: "Complaints", tolerated: "tolerated", allHealthy: "All measured indicators are healthy.", manual: "A manual review is required.", recent: "Recent messages", day: "Day", categoryStatus: "Yodev category and status", all: "View all", noMessage: "No message created." },
  });
  const context = await requirePageWorkspace();
  const [data, evidence, timeZone] = await Promise.all([
    getDashboardData(context.workspace.id),
    getActivationEvidence(requireDb(), context.workspace.id),
    getWorkspaceTimeZone(context.workspace.id),
  ]);
  const dateFormat = dateTimeFormatter(locale, timeZone);
  const dayFormat = new Intl.DateTimeFormat(formatLocale, { dateStyle: "medium", timeZone: "UTC" });
  const activitySummary = localized(locale, {
    fr: `${data.totals.accepted.toLocaleString(formatLocale)} emails acceptés sur ${data.activity.length} jour${data.activity.length > 1 ? "s" : ""} d’activité ; maximum quotidien : ${maxDayLabel(data.activity, formatLocale)}.`,
    en: `${data.totals.accepted.toLocaleString(formatLocale)} emails accepted over ${data.activity.length} active day${data.activity.length > 1 ? "s" : ""}; daily maximum: ${maxDayLabel(data.activity, formatLocale)}.`,
  });
  const deliveredRate = percent(data.totals.delivered, data.totals.accepted);
  const complaintRate = percent(data.totals.complaints, data.totals.accepted);
  const bounceRate = percent(data.totals.hardBounces, data.totals.accepted);
  const maxDay = Math.max(1, ...data.activity.map((day) => day.acceptedEmails));
  const healthy = data.totals.complaints === 0 && data.totals.hardBounces < 3 && bounceRate < 2;
  return <>
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">{new Intl.DateTimeFormat(formatLocale, { dateStyle: "full" }).format(new Date())}</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.workspace.name}</h1><p className="mt-2 text-muted-foreground">{copy.intro}</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link href={href("/dashboard/profils")}>{copy.declare}</Link></Button><Button asChild><Link href={href("/dashboard/domaines")}>{copy.addDomain}</Link></Button></div></div>
    <SetupChecklist evidence={evidence} gates={{ liveSending: isFeatureEnabled("LIVE_EMAIL_ACCEPTANCE_ENABLED"), customerWebhooks: isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED") }} locale={locale}/>
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label={copy.acceptedMonth} value={data.currentMonthAccepted.toLocaleString(formatLocale)} detail={copy.billingBase} icon={Send}/><StatCard label={copy.delivered30} value={rate(deliveredRate)} detail={`${data.totals.delivered.toLocaleString(formatLocale)} ${copy.confirmations}`} icon={MailCheck}/><StatCard label={copy.pending} value={String((data.statusCounts.queued ?? 0)+(data.statusCounts.sending ?? 0))} detail={copy.queue} icon={Activity}/><StatCard label={copy.reputation} value={data.totals.accepted === 0 ? (locale === "fr" ? "Non mesurée" : "Not measured") : healthy?copy.healthy:copy.review} detail={`${rate(complaintRate)} ${copy.complaints}`} icon={healthy?ShieldCheck:TriangleAlert}/></div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]"><section className="rounded-md border bg-card p-6 "><div className="flex items-center justify-between"><div><h2 className="font-semibold">{copy.activity}</h2><p className="text-sm text-muted-foreground">{copy.last30}</p></div><Badge variant="secondary">{copy.accepted}</Badge></div>{data.activity.length?<figure className="mt-8"><div aria-hidden="true" className="flex h-52 items-end gap-2">{data.activity.map((day)=><div className="min-h-1 flex-1 rounded-t-sm bg-primary" key={day.day} style={{height:`${Math.max(2,percent(day.acceptedEmails,maxDay))}%`}} title={`${day.day}: ${day.acceptedEmails}`}/>)}</div><figcaption className="mt-3 text-xs text-muted-foreground">{activitySummary}</figcaption><table className="sr-only"><caption>{copy.activity}</caption><thead><tr><th scope="col">{copy.day}</th><th scope="col">{copy.accepted}</th></tr></thead><tbody>{data.activity.map((day)=><tr key={day.day}><td>{dayFormat.format(new Date(`${day.day}T00:00:00Z`))}</td><td>{day.acceptedEmails.toLocaleString(formatLocale)}</td></tr>)}</tbody></table></figure>:<div className="mt-8 grid h-52 place-items-center rounded-md bg-muted text-sm text-muted-foreground">{copy.noSend}</div>}</section><section className="rounded-md border bg-card p-6 "><h2 className="font-semibold">{copy.safeguards}</h2><div className="mt-6 grid gap-6"><Metric label={copy.quota} value={`${data.todayAccepted.toLocaleString(formatLocale)} / ${data.workspace.dailyLimit.toLocaleString(formatLocale)}`} progress={percent(data.todayAccepted,data.workspace.dailyLimit)}/><Metric label="Hard bounces" value={`${rate(bounceRate)} / 2 %`} progress={percent(bounceRate,2)}/><Metric label={copy.complaint} value={`${data.totals.complaints} / 0 ${copy.tolerated}`} progress={data.totals.complaints?100:0}/></div><div className={`mt-7 rounded-md p-4 text-sm ${healthy?"y-status-success":"y-status-warning"}`}><Activity className="mr-2 inline size-4"/>{data.totals.accepted === 0 ? copy.noSend : healthy?copy.allHealthy:copy.manual}</div></section></div>
    <section className="mt-6 rounded-md border bg-card "><div className="flex items-center justify-between border-b p-5"><div><h2 className="font-semibold">{copy.recent}</h2><p className="text-sm text-muted-foreground">{copy.categoryStatus}</p></div><Button asChild variant="ghost"><Link href={href("/dashboard/emails")}>{copy.all} <ArrowUpRight/></Link></Button></div>{data.recentMessages.length?data.recentMessages.map((message)=><div className="grid grid-cols-[1fr_auto] items-center gap-4 border-b px-5 py-4 last:border-0 sm:grid-cols-3" key={message.id}><span className="font-medium">{message.category}</span><Badge variant="secondary">{statusLabel(locale,message.status)}</Badge><span className="hidden text-sm text-muted-foreground sm:block">{<time dateTime={message.createdAt.toISOString()}>{dateFormat.format(message.createdAt)}</time>}</span></div>):<p className="p-8 text-center text-sm text-muted-foreground">{copy.noMessage}</p>}</section>
  </>;
}

function Metric({label,progress,value}:{label:string;progress:number;value:string}){return <div><div className="mb-2 flex justify-between text-sm"><span>{label}</span><span className="text-muted-foreground">{value}</span></div><Progress aria-label={label} aria-valuetext={value} value={Math.min(100,progress)}/></div>}

function maxDayLabel(activity:{day:string;acceptedEmails:number}[],formatLocale:string){const top=activity.reduce((best,day)=>day.acceptedEmails>best.acceptedEmails?day:best,activity[0]);return top?`${top.acceptedEmails.toLocaleString(formatLocale)} (${top.day})`:"0"}
