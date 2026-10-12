import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DashboardPage } from "@/components/dashboard-page";
import { requireDb } from "@/db";
import { requirePageWorkspace } from "@/lib/page-auth";
import { dateTimeFormatter } from "@/lib/date-time";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";
import { localized, localizedPath } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";
import { listWorkspaceEmails, messageStatuses, parseEmailListFilters } from "./list-query";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Emails envoyés", en: "Sent emails" }) };
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 2)}${"•".repeat(Math.min(6, Math.max(2, local.length - 2)))}@${domain}`;
}

const statusVariant = (status: string) =>
  status === "delivered" || status === "sent"
    ? "default"
    : status === "failed" || status === "hard_bounced" || status === "complained"
      ? "destructive"
      : "secondary";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { title: "Emails", description: "Chaque message transactionnel et son statut normalisé, indépendamment du service de livraison utilisé.", date: "Date", recipient: "Destinataire", subject: "Sujet", category: "Catégorie", status: "Statut", mode: "Mode", empty: "Aucun message n’a encore été créé.", noMatch: "Aucun message ne correspond à ces filtres.", filters: "Filtrer les emails", allStatuses: "Tous les statuts", from: "Du", to: "Au", apply: "Filtrer", reset: "Réinitialiser", next: "Messages plus anciens", first: "Revenir aux plus récents", pagination: "Pagination", zone: "Heures affichées dans le fuseau", caption: "Emails du workspace, du plus récent au plus ancien" },
    en: { title: "Emails", description: "Every transactional message and its normalized status, regardless of the delivery provider.", date: "Date", recipient: "Recipient", subject: "Subject", category: "Category", status: "Status", mode: "Mode", empty: "No message has been created yet.", noMatch: "No message matches these filters.", filters: "Filter emails", allStatuses: "All statuses", from: "From", to: "To", apply: "Filter", reset: "Reset", next: "Older messages", first: "Back to the most recent", pagination: "Pagination", zone: "Times shown in the time zone", caption: "Workspace emails, newest first" },
  });
  const context = await requirePageWorkspace();
  const filters = parseEmailListFilters(await searchParams);
  const timeZone = await getWorkspaceTimeZone(context.workspace.id);
  const { rows, nextCursor } = await listWorkspaceEmails(requireDb(), context.workspace.id, filters, timeZone);
  const dateFormat = dateTimeFormatter(locale, timeZone);
  const basePath = localizedPath(locale, "/dashboard/emails");
  const query = (cursor?: string) => {
    const params = new URLSearchParams();
    if (filters.status) params.set("status", filters.status);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (cursor) params.set("cursor", cursor);
    const value = params.toString();
    return value ? `${basePath}?${value}` : basePath;
  };
  const filtered = Boolean(filters.status || filters.from || filters.to);
  return (
    <DashboardPage description={copy.description} title={copy.title}>
      <form action={basePath} aria-label={copy.filters} className="mb-6 grid gap-4 rounded-md border bg-card p-5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" method="get">
        <div className="grid gap-2"><Label htmlFor="email-status">{copy.status}</Label><select className="h-10 rounded-md border bg-card px-3 text-sm" defaultValue={filters.status ?? ""} id="email-status" name="status"><option value="">{copy.allStatuses}</option>{messageStatuses.map((status) => <option key={status} value={status}>{statusLabel(locale, status)}</option>)}</select></div>
        <div className="grid gap-2"><Label htmlFor="email-from">{copy.from}</Label><Input className="h-10" defaultValue={filters.from} id="email-from" name="from" type="date" /></div>
        <div className="grid gap-2"><Label htmlFor="email-to">{copy.to}</Label><Input className="h-10" defaultValue={filters.to} id="email-to" name="to" type="date" /></div>
        <div className="flex gap-2"><Button className="h-10" type="submit">{copy.apply}</Button>{filtered ? <Button asChild className="h-10" variant="ghost"><Link href={basePath}>{copy.reset}</Link></Button> : null}</div>
        <p className="text-xs text-muted-foreground sm:col-span-4">{copy.zone} {timeZone}.</p>
      </form>
      <div className="overflow-hidden rounded-md border bg-card ">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{copy.caption}</caption>
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {[copy.date, copy.recipient, copy.subject, copy.category, copy.mode, copy.status].map((label) => (
                  <th className="px-5 py-3 font-medium" key={label} scope="col">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((message) => (
                <tr className="border-b last:border-0 hover:bg-muted/30" key={message.id}>
                  <td className="whitespace-nowrap px-5 py-4 text-muted-foreground"><time dateTime={message.createdAt.toISOString()}>{dateFormat.format(message.createdAt)}</time></td>
                  <td className="px-5 py-4 font-mono text-xs">{maskEmail(message.toEmail)}</td>
                  <td className="max-w-64 truncate px-5 py-4"><Link className="font-medium hover:text-primary" href={localizedPath(locale, `/dashboard/emails/${message.id}`)}>{message.subject}</Link></td>
                  <td className="px-5 py-4">{message.category ? <Badge variant="outline">{message.category}</Badge> : null}</td>
                  <td className="px-5 py-4 text-muted-foreground">{statusLabel(locale, message.sendMode)}</td>
                  <td className="px-5 py-4"><Badge variant={statusVariant(message.status)}>{statusLabel(locale, message.status)}</Badge></td>
                </tr>
              ))}
              {!rows.length && <tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={6}>{filtered || filters.cursor ? copy.noMatch : copy.empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {nextCursor || filters.cursor ? <nav aria-label={copy.pagination} className="mt-4 flex flex-wrap justify-between gap-3">
        {filters.cursor ? <Button asChild variant="outline"><Link href={query()}>{copy.first}</Link></Button> : <span />}
        {nextCursor ? <Button asChild variant="outline"><Link href={query(nextCursor)} rel="next">{copy.next}</Link></Button> : null}
      </nav> : null}
    </DashboardPage>
  );
}
