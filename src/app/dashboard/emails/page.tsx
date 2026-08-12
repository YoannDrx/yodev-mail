import { Badge } from "@/components/ui/badge";
import { DashboardPage } from "@/components/dashboard-page";
import Link from "next/link";
import { getRecentMessages } from "@/features/dashboard/queries";
import { requirePageWorkspace } from "@/lib/page-auth";

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
  const context = await requirePageWorkspace();
  const rows = context ? await getRecentMessages(context.workspace.id) : [];
  return (
    <DashboardPage
      description="Chaque message transactionnel et son statut normalisé, indépendamment du service de livraison utilisé."
      title="Emails"
    >
      <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                {['Date', 'Destinataire', 'Sujet', 'Catégorie', 'Statut'].map((label) => (
                  <th className="px-5 py-3 font-medium" key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((message) => (
                <tr className="border-b last:border-0 hover:bg-muted/30" key={message.id} title={message.lastError ?? undefined}>
                  <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(message.createdAt)}</td>
                  <td className="px-5 py-4 font-mono text-xs">{maskEmail(message.toEmail)}</td>
                  <td className="max-w-64 truncate px-5 py-4"><Link className="font-medium hover:text-primary" href={`/dashboard/emails/${message.id}`}>{message.subject}</Link></td>
                  <td className="px-5 py-4"><Badge variant="outline">{message.category}</Badge></td>
                  <td className="px-5 py-4"><Badge variant={statusVariant(message.status)}>{message.status}</Badge></td>
                </tr>
              ))}
              {!rows.length && <tr><td className="px-5 py-12 text-center text-muted-foreground" colSpan={5}>Aucun message n’a encore été créé.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardPage>
  );
}
