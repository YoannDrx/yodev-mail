import { eq } from "drizzle-orm";
import { Activity, CheckCircle2, Gauge, ShieldAlert } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { requireDb } from "@/db";
import { domains } from "@/db/schema";
import { getReputationWindow } from "@/features/dashboard/queries";
import { getSesAccountStatus } from "@/features/deliverability/ses-account";
import { requirePageWorkspace } from "@/lib/page-auth";

const rate = (value: number, total: number) => total ? value / total * 100 : 0;
const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export default async function Page() {
  const context = await requirePageWorkspace();
  if (!context) return <DashboardPage description="Configuration requise." title="Délivrabilité"><></></DashboardPage>;
  const [reputation, domainRows, ses] = await Promise.all([
    getReputationWindow(context.workspace.id),
    requireDb().select().from(domains).where(eq(domains.workspaceId, context.workspace.id)),
    getSesAccountStatus(),
  ]);
  const bounce = rate(reputation.hardBounces, reputation.accepted);
  const complaint = rate(reputation.complaints, reputation.accepted);
  const verified = domainRows.filter((domain) => domain.status === "verified").length;
  const accountUsage = ses?.max24HourSend ? ses.sentLast24Hours / ses.max24HourSend * 100 : 0;

  return (
    <DashboardPage description="Authentification, quotas SES et réputation calculée sur les 30 derniers jours." title="Délivrabilité">
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Card healthy={verified === domainRows.length && domainRows.length > 0} icon={verified === domainRows.length && domainRows.length ? CheckCircle2 : ShieldAlert} text={`${verified} / ${domainRows.length} domaines vérifiés`} title="Authentification" />
        <Card healthy={bounce < 2 && complaint < 0.1} icon={Activity} text={`${reputation.accepted.toLocaleString("fr-FR")} acceptés · ${reputation.delivered.toLocaleString("fr-FR")} délivrés`} title="Réputation Mail by Yodev" />
        <Card healthy={context.workspace.status === "approved"} icon={ShieldAlert} text={`Étape ${context.workspace.warmupStage} · ${context.workspace.dailyLimit.toLocaleString("fr-FR")} emails/jour`} title="Quota workspace" />
        <Card healthy={Boolean(ses?.sendingEnabled && ses.productionAccess && ses.enforcementStatus === "HEALTHY")} icon={Gauge} text={ses ? `${number.format(ses.sentLast24Hours)} / ${number.format(ses.max24HourSend)} sur 24 h` : "Quota SES indisponible"} title="Compte Amazon SES" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="font-semibold">Seuils automatiques du workspace</h2>
          <div className="mt-6 grid gap-6"><Metric alert={2} label="Hard bounces" pause={5} value={bounce} /><Metric alert={0.1} label="Plaintes" pause={0.2} value={complaint} /></div>
        </section>
        <section className="rounded-2xl border bg-white p-6">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Capacité SES partagée</h2><Badge variant={ses?.productionAccess ? "default" : "secondary"}>{ses?.productionAccess ? "Production" : "Sandbox / indisponible"}</Badge></div>
          {ses ? <><div className="mt-6 flex justify-between text-sm"><span>{number.format(ses.sentLast24Hours)} envoyés</span><span>{number.format(ses.max24HourSend)} autorisés / 24 h</span></div><Progress className="mt-3" value={Math.min(100, accountUsage)} /><dl className="mt-6 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-muted-foreground">Cadence maximale</dt><dd className="mt-1 font-semibold">{number.format(ses.maxSendRate)} / seconde</dd></div><div><dt className="text-muted-foreground">Réputation AWS</dt><dd className="mt-1 font-semibold">{ses.enforcementStatus}</dd></div></dl></> : <p className="mt-6 text-sm text-muted-foreground">Le rôle AWS de cet environnement ne permet pas encore de lire le quota SES.</p>}
        </section>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border bg-white">
        <table className="w-full text-sm"><thead><tr className="border-b text-left text-muted-foreground">{["Domaine", "DKIM", "MAIL FROM", "DMARC", "Dernière vérification"].map((label) => <th className="px-5 py-3 font-medium" key={label}>{label}</th>)}</tr></thead><tbody>{domainRows.map((domain) => <tr className="border-b last:border-0" key={domain.id}><td className="px-5 py-4 font-medium">{domain.name}</td><td className="px-5 py-4">{domain.dkimStatus}</td><td className="px-5 py-4">{domain.mailFromStatus}</td><td className="px-5 py-4">{domain.dmarcStatus}</td><td className="px-5 py-4 text-muted-foreground">{domain.lastCheckedAt ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(domain.lastCheckedAt) : "Jamais"}</td></tr>)}{!domainRows.length && <tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>Ajoutez un domaine pour démarrer le diagnostic.</td></tr>}</tbody></table>
      </div>
    </DashboardPage>
  );
}

function Card({ healthy, icon: Icon, text, title }: { healthy: boolean; icon: typeof Activity; text: string; title: string }) {
  return <article className="rounded-2xl border bg-white p-6"><Icon className={`size-6 ${healthy ? "text-emerald-600" : "text-amber-600"}`} /><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{text}</p></article>;
}

function Metric({ alert, label, pause, value }: { alert: number; label: string; pause: number; value: number }) {
  return <div><div className="flex justify-between"><span>{label}</span><strong>{value.toFixed(3).replace(".", ",")} %</strong></div><Progress className="my-3" value={Math.min(100, value / pause * 100)} /><p className="text-xs text-muted-foreground">Alerte {String(alert).replace(".", ",")} % · Pause {String(pause).replace(".", ",")} %</p></div>;
}
