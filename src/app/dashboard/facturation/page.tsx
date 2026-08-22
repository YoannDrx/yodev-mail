import { and, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { CreditCard } from "lucide-react";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireDb } from "@/db";
import { subscriptions, usageMonths } from "@/db/schema";
import { checkoutAction, portalAction } from "@/features/billing/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
import { isFeatureEnabled } from "@/lib/env";
import { localized } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export default async function Page(){
  const locale=await getLocale();const formatLocale=localeCode(locale);const copy=localized(locale,{fr:{title:"Facturation",setup:"Configuration requise.",description:"Abonnement privé et emails acceptés pour livraison.",beta:"Bêta privée",month:"mois",limits:"2 domaines · 3 membres · aucun email inclus",stripe:"Statut Stripe",pilotUntil:"Accès pilote interne jusqu’au",accepted:"emails acceptés",usage:"2,50 € par tranche de 1 000, mesuré à 0,0025 € par email sans arrondi par requête. TVA appliquée selon le régime fiscal en vigueur.",manage:"Gérer l’abonnement",portal:"Ouvrir le portail Stripe",approved:"Votre dossier est approuvé. Ce checkout privé active l’accès plateforme et la mesure à l’usage.",finalize:"Finaliser l’abonnement",soon:"La souscription ouvrira après la certification finale de la facturation.",after:"L’abonnement devient accessible après approbation du dossier. Aucun checkout public n’est proposé."},en:{title:"Billing",setup:"Configuration required.",description:"Private subscription and emails accepted for delivery.",beta:"Private beta",month:"month",limits:"2 domains · 3 members · no emails included",stripe:"Stripe status",pilotUntil:"Internal pilot access until",accepted:"accepted emails",usage:"€2.50 per 1,000, metered at €0.0025 per email with no per-request rounding. VAT is applied according to the applicable tax status.",manage:"Manage subscription",portal:"Open Stripe portal",approved:"Your application is approved. This private checkout activates platform access and metered usage.",finalize:"Complete subscription",soon:"Subscriptions will open after final billing certification.",after:"The subscription becomes available after the application is approved. No public checkout is offered."}});
  const context=await requirePageWorkspace();
  if(!context)return <DashboardPage title={copy.title} description={copy.setup}><></></DashboardPage>;
  const month=new Date().toISOString().slice(0,7);
  const [subscription,usage]=await Promise.all([
    requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId,context.workspace.id)).limit(1).then((rows)=>rows[0]),
    requireDb().select().from(usageMonths).where(and(eq(usageMonths.workspaceId,context.workspace.id),eq(usageMonths.month,month))).limit(1).then((rows)=>rows[0]),
  ]);
  const accepted=usage?.acceptedEmails??0;
  const estimate=accepted*0.0025;
  const checkoutEnabled=isFeatureEnabled("LIVE_CHECKOUT_ENABLED");
  return <DashboardPage title={copy.title} description={copy.description}><div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]"><article className="rounded-2xl border bg-white p-6"><div className="flex justify-between"><div><Badge>{copy.beta}</Badge><p className="mt-3 text-3xl font-semibold">29 € / {copy.month}</p><p className="mt-2 text-sm text-muted-foreground">{copy.limits}</p><p className="mt-1 text-sm text-muted-foreground">{copy.stripe} : {statusLabel(locale,subscription?.status??"inactive")}</p>{subscription?.pilotAccessExpiresAt && <p className="mt-1 text-sm text-muted-foreground">{copy.pilotUntil} {subscription.pilotAccessExpiresAt.toLocaleString(formatLocale)}</p>}</div><CreditCard className="text-primary"/></div><div className="mt-8 rounded-xl bg-zinc-50 p-5"><div className="flex justify-between text-sm"><span>{accepted.toLocaleString(formatLocale)} {copy.accepted}</span><strong>{new Intl.NumberFormat(formatLocale,{style:"currency",currency:"EUR"}).format(estimate)}</strong></div><p className="mt-2 text-xs text-muted-foreground">{copy.usage}</p></div></article><article className="rounded-2xl border bg-white p-6"><h2 className="font-semibold">{copy.manage}</h2>{subscription?.stripeCustomerId?<form action={portalAction}><Button className="mt-6" type="submit" variant="outline">{copy.portal}</Button></form>:context.workspace.status === "approved"&&checkoutEnabled?<><p className="mt-3 text-sm text-muted-foreground">{copy.approved}</p><form action={checkoutAction}><Button className="mt-6" type="submit">{copy.finalize}</Button></form></>:context.workspace.status === "approved"?<p className="mt-3 text-sm text-muted-foreground">{copy.soon}</p>:<p className="mt-3 text-sm text-muted-foreground">{copy.after}</p>}</article></div></DashboardPage>;
}
