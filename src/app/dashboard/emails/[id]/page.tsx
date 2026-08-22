import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleDashed, MailWarning } from "lucide-react";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { DashboardPage } from "@/components/dashboard-page";
import { getMessageDetail } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized, localizedPath } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

function formatDate(date: Date | null, locale: string) {
  return date
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(date)
    : "—";
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, { fr: { all: "Tous les emails", description: "Chronologie Yodev et diagnostic normalisé de cette livraison.", created: "Message créé", attempt: "Tentative", from: "De", to: "À", createdAt: "Créé", accepted: "Accepté pour livraison", delivered: "Délivré", reference: "Référence Yodev", lastError: "Dernière erreur", retentionBefore: "Le contenu complet est conservé jusqu’au", retentionAfter: "Il n’est pas affiché dans ce diagnostic afin de limiter l’exposition des données.", timeline: "Chronologie" }, en: { all: "All emails", description: "Yodev timeline and normalized delivery diagnosis.", created: "Message created", attempt: "Attempt", from: "From", to: "To", createdAt: "Created", accepted: "Accepted for delivery", delivered: "Delivered", reference: "Yodev reference", lastError: "Latest error", retentionBefore: "The full content is retained until", retentionAfter: "It is not displayed in this diagnostic to limit data exposure.", timeline: "Timeline" } });
  const parsedId = z.string().uuid().safeParse((await params).id);
  if (!parsedId.success) notFound();
  const id = parsedId.data;
  const context = await requirePageWorkspace();
  if (!context) notFound();
  const result = await getMessageDetail(context.workspace.id, id);
  if (!result) notFound();
  const { message, attempts, events } = result;
  const timeline = [
    { at: message.createdAt, label: copy.created, type: "created" },
    ...attempts.map((attempt) => ({ at: attempt.createdAt, label: `${copy.attempt} ${attempt.attempt} · ${statusLabel(locale, attempt.status)}`, type: attempt.status })),
    ...events.map((event) => ({ at: event.occurredAt, label: statusLabel(locale, event.type.replace("email.", "")), type: event.type })),
  ].sort((left, right) => left.at.getTime() - right.at.getTime());

  return (
    <DashboardPage
      action={<Link className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground" href={localizedPath(locale, "/dashboard/emails")}><ArrowLeft className="size-4" />{copy.all}</Link>}
      description={copy.description}
      title={message.subject}
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3"><Badge>{statusLabel(locale, message.status)}</Badge><Badge variant="outline">{message.contentKind}</Badge><Badge variant="secondary">{statusLabel(locale, message.sendMode)}</Badge></div>
          <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{copy.from}</dt><dd className="mt-1 font-medium">{message.fromName ? `${message.fromName} <${message.fromEmail}>` : message.fromEmail}</dd></div>
            <div><dt className="text-muted-foreground">{copy.to}</dt><dd className="mt-1 font-medium">{message.toName ? `${message.toName} <${message.toEmail}>` : message.toEmail}</dd></div>
            <div><dt className="text-muted-foreground">{copy.createdAt}</dt><dd className="mt-1">{formatDate(message.createdAt, formatLocale)}</dd></div>
            <div><dt className="text-muted-foreground">{copy.accepted}</dt><dd className="mt-1">{formatDate(message.providerAcceptedAt, formatLocale)}</dd></div>
            <div><dt className="text-muted-foreground">{copy.delivered}</dt><dd className="mt-1">{formatDate(message.deliveredAt, formatLocale)}</dd></div>
            <div><dt className="text-muted-foreground">{copy.reference}</dt><dd className="mt-1 break-all font-mono text-xs">{message.id}</dd></div>
          </dl>
          {message.lastError && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>{copy.lastError}</strong><p className="mt-1">{message.lastError}</p></div>}
          <div className="mt-6 border-t pt-5"><p className="text-xs text-muted-foreground">{copy.retentionBefore} {formatDate(message.contentExpiresAt, formatLocale)}. {copy.retentionAfter}</p></div>
        </section>

        <section className="rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="font-semibold">{copy.timeline}</h2>
          <ol className="mt-6 grid gap-5">
            {timeline.map((item, index) => {
              const failed = /fail|bounce|complaint/i.test(item.type);
              const Icon = failed ? MailWarning : /deliver|sent|accept/i.test(item.type) ? CheckCircle2 : CircleDashed;
              return <li className="grid grid-cols-[24px_1fr] gap-3" key={`${item.type}-${item.at.toISOString()}-${index}`}><Icon className={`mt-0.5 size-5 ${failed ? "text-red-600" : "text-emerald-600"}`} /><div><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-xs text-muted-foreground">{formatDate(item.at, formatLocale)}</p></div></li>;
            })}
          </ol>
        </section>
      </div>
    </DashboardPage>
  );
}
