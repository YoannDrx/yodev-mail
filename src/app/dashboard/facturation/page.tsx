import type { Metadata } from "next";
import { and, eq } from "drizzle-orm";
import { CheckCircle2, CreditCard, Info } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { requireDb } from "@/db";
import { subscriptions, usageMonths } from "@/db/schema";
import { CheckoutForm, PortalForm } from "@/features/billing/billing-forms";
import { requirePageWorkspace } from "@/lib/page-auth";
import { isFeatureEnabled } from "@/lib/env";
import { localized } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocale()) === "fr" ? "Facturation" : "Billing" };
}

export default async function Page({ searchParams }: { searchParams: Promise<{ checkout?: string | string[] }> }) {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, {
    fr: { title: "Facturation", setup: "Configuration requise.", description: "Abonnement privé et emails acceptés pour livraison.", beta: "Bêta privée", month: "mois", limits: "2 domaines · 3 membres · aucun email inclus", stripe: "Statut Stripe", pilotUntil: "Accès pilote interne jusqu’au", accepted: "emails acceptés", usage: "2,50 € par tranche de 1 000, mesuré à 0,0025 € par email sans arrondi par requête. TVA appliquée selon le régime fiscal en vigueur.", manage: "Gérer l’abonnement", approved: "Votre dossier est approuvé. Ce checkout privé active l’accès plateforme et la mesure à l’usage.", soon: "La souscription ouvrira après la certification finale de la facturation.", after: "L’abonnement devient accessible après approbation du dossier. Aucun checkout public n’est proposé.", success: "Paiement confirmé par Stripe. L’abonnement apparaît comme actif dès que Stripe nous l’a notifié, en général en moins d’une minute : rechargez la page si besoin.", cancelled: "Souscription interrompue : aucun paiement n’a été effectué. Vous pouvez la reprendre quand vous le souhaitez." },
    en: { title: "Billing", setup: "Configuration required.", description: "Private subscription and emails accepted for delivery.", beta: "Private beta", month: "month", limits: "2 domains · 3 members · no emails included", stripe: "Stripe status", pilotUntil: "Internal pilot access until", accepted: "accepted emails", usage: "€2.50 per 1,000, metered at €0.0025 per email with no per-request rounding. VAT is applied according to the applicable tax status.", manage: "Manage subscription", approved: "Your application is approved. This private checkout activates platform access and metered usage.", soon: "Subscriptions will open after final billing certification.", after: "The subscription becomes available after the application is approved. No public checkout is offered.", success: "Payment confirmed by Stripe. The subscription shows as active as soon as Stripe notifies us, usually within a minute: reload the page if needed.", cancelled: "Checkout cancelled: no payment was made. You can resume it whenever you like." },
  });
  const context = await requirePageWorkspace();
  if (!context) return <DashboardPage title={copy.title} description={copy.setup}><></></DashboardPage>;
  const { checkout } = await searchParams;
  const checkoutResult = checkout === "success" ? "success" : checkout === "cancelled" ? "cancelled" : null;
  const month = new Date().toISOString().slice(0, 7);
  const [subscription, usage] = await Promise.all([
    requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId, context.workspace.id)).limit(1).then((rows) => rows[0]),
    requireDb().select().from(usageMonths).where(and(eq(usageMonths.workspaceId, context.workspace.id), eq(usageMonths.month, month))).limit(1).then((rows) => rows[0]),
  ]);
  const accepted = usage?.acceptedEmails ?? 0;
  const estimate = accepted * 0.0025;
  const checkoutEnabled = isFeatureEnabled("LIVE_CHECKOUT_ENABLED");
  return (
    <DashboardPage title={copy.title} description={copy.description}>
      {checkoutResult && (
        <div
          className={checkoutResult === "success" ? "mb-6 flex gap-3 rounded-md border y-status-success p-4 text-sm" : "mb-6 flex gap-3 rounded-md border bg-muted p-4 text-sm"}
          role="status"
        >
          {checkoutResult === "success" ? <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-[var(--y-success)]" /> : <Info aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />}
          <p>{checkoutResult === "success" ? copy.success : copy.cancelled}</p>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <article className="rounded-md border bg-card p-6">
          <div className="flex justify-between">
            <div>
              <Badge>{copy.beta}</Badge>
              <p className="mt-3 text-3xl font-semibold">29 € / {copy.month}</p>
              <p className="mt-2 text-sm text-muted-foreground">{copy.limits}</p>
              <p className="mt-1 text-sm text-muted-foreground">{copy.stripe} : {statusLabel(locale, subscription?.status ?? "inactive")}</p>
              {subscription?.pilotAccessExpiresAt && <p className="mt-1 text-sm text-muted-foreground">{copy.pilotUntil} {subscription.pilotAccessExpiresAt.toLocaleString(formatLocale)}</p>}
            </div>
            <CreditCard aria-hidden="true" className="text-primary" />
          </div>
          <div className="mt-8 rounded-md bg-muted p-5">
            <div className="flex justify-between text-sm">
              <span>{accepted.toLocaleString(formatLocale)} {copy.accepted}</span>
              <strong>{new Intl.NumberFormat(formatLocale, { style: "currency", currency: "EUR" }).format(estimate)}</strong>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">{copy.usage}</p>
          </div>
        </article>
        <article className="rounded-md border bg-card p-6">
          <h2 className="font-semibold">{copy.manage}</h2>
          {subscription?.stripeCustomerId ? (
            <PortalForm locale={locale} />
          ) : context.workspace.status === "approved" && checkoutEnabled ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">{copy.approved}</p>
              <CheckoutForm locale={locale} />
            </>
          ) : context.workspace.status === "approved" ? (
            <p className="mt-3 text-sm text-muted-foreground">{copy.soon}</p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{copy.after}</p>
          )}
        </article>
      </div>
    </DashboardPage>
  );
}
