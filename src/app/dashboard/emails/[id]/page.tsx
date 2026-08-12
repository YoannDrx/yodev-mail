import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleDashed, MailWarning } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DashboardPage } from "@/components/dashboard-page";
import { getMessageDetail } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";

function formatDate(date: Date | null) {
  return date
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium" }).format(date)
    : "—";
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requirePageWorkspace();
  if (!context) notFound();
  const result = await getMessageDetail(context.workspace.id, id);
  if (!result) notFound();
  const { message, attempts, events } = result;
  const timeline = [
    { at: message.createdAt, label: "Message créé", type: "created" },
    ...attempts.map((attempt) => ({ at: attempt.createdAt, label: `Tentative ${attempt.attempt} · ${attempt.status}`, type: attempt.status })),
    ...events.map((event) => ({ at: event.occurredAt, label: event.type, type: event.type })),
  ].sort((left, right) => left.at.getTime() - right.at.getTime());

  return (
    <DashboardPage
      action={<Link className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" href="/dashboard/emails"><ArrowLeft className="size-4" />Tous les emails</Link>}
      description="Chronologie Yodev et diagnostic normalisé de cette livraison."
      title={message.subject}
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3"><Badge>{message.status}</Badge><Badge variant="outline">{message.contentKind}</Badge><Badge variant="secondary">{message.sendMode}</Badge></div>
          <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">De</dt><dd className="mt-1 font-medium">{message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}</dd></div>
            <div><dt className="text-muted-foreground">À</dt><dd className="mt-1 font-medium">{message.toName ? `${message.toName} <${message.toEmail}>` : message.toEmail}</dd></div>
            <div><dt className="text-muted-foreground">Créé</dt><dd className="mt-1">{formatDate(message.createdAt)}</dd></div>
            <div><dt className="text-muted-foreground">Accepté pour livraison</dt><dd className="mt-1">{formatDate(message.providerAcceptedAt)}</dd></div>
            <div><dt className="text-muted-foreground">Délivré</dt><dd className="mt-1">{formatDate(message.deliveredAt)}</dd></div>
            <div><dt className="text-muted-foreground">Référence Yodev</dt><dd className="mt-1 break-all font-mono text-xs">{message.id}</dd></div>
          </dl>
          {message.lastError && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>Dernière erreur</strong><p className="mt-1">{message.lastError}</p></div>}
          <div className="mt-6 border-t pt-5"><p className="text-xs text-muted-foreground">Le contenu complet est conservé jusqu’au {formatDate(message.contentExpiresAt)}. Il n’est pas affiché dans ce diagnostic afin de limiter l’exposition des données.</p></div>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">Chronologie</h2>
          <ol className="mt-6 grid gap-5">
            {timeline.map((item, index) => {
              const failed = /fail|bounce|complaint/i.test(item.type);
              const Icon = failed ? MailWarning : /deliver|sent|accept/i.test(item.type) ? CheckCircle2 : CircleDashed;
              return <li className="grid grid-cols-[24px_1fr] gap-3" key={`${item.type}-${item.at.toISOString()}-${index}`}><Icon className={`mt-0.5 size-5 ${failed ? "text-red-600" : "text-emerald-600"}`} /><div><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.at)}</p></div></li>;
            })}
          </ol>
        </section>
      </div>
    </DashboardPage>
  );
}
