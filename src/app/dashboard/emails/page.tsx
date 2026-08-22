import { Badge } from "@/components/ui/badge";
import { DashboardPage } from "@/components/dashboard-page";
import Link from "next/link";
import { getRecentMessages } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized, localizedPath } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

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

export default async function Page() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, { fr: { description: "Chaque message transactionnel et son statut normalisé, indépendamment du service de livraison utilisé.", date: "Date", recipient: "Destinataire", subject: "Sujet", category: "Catégorie", status: "Statut", empty: "Aucun message n’a encore été créé." }, en: { description: "Every transactional message and its normalized status, regardless of the delivery provider.", date: "Date", recipient: "Recipient", subject: "Subject", category: "Category", status: "Status", empty: "No message has been created yet." } });
  const context = await requirePageWorkspace();
  const rows = context ? await getRecentMessages(context.workspace.id) : [];
  return (
    <DashboardPage
      description={copy.description}
      title="Emails"
    >
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {[copy.date, copy.recipient, copy.subject, copy.category, copy.status].map((label) => (
                  <th className="px-5 py-3 font-medium" key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((message) => (
                <tr className="border-b last:border-0 hover:bg-muted/30" key={message.id} title={message.lastError ?? undefined}>
                  <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{new Intl.DateTimeFormat(formatLocale, { dateStyle: 'short', timeStyle: 'short' }).format(message.createdAt)}</td>
                  <td className="px-5 py-4 font-mono text-xs">{maskEmail(message.toEmail)}</td>
                  <td className="max-w-64 truncate px-5 py-4"><Link className="font-medium hover:text-primary" href={localizedPath(locale, `/dashboard/emails/${message.id}`)}>{message.subject}</Link></td>
                  <td className="px-5 py-4"><Badge variant="outline">{message.category}</Badge></td>
                  <td className="px-5 py-4"><Badge variant={statusVariant(message.status)}>{statusLabel(locale, message.status)}</Badge></td>
                </tr>
              ))}
              {!rows.length && <tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>{copy.empty}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardPage>
  );
}
