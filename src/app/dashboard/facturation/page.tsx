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

export default async function Page(){
  const context=await requirePageWorkspace();
  if(!context)return <DashboardPage title="Facturation" description="Configuration requise."><></></DashboardPage>;
  const month=new Date().toISOString().slice(0,7);
  const [subscription,usage]=await Promise.all([
    requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId,context.workspace.id)).limit(1).then((rows)=>rows[0]),
    requireDb().select().from(usageMonths).where(and(eq(usageMonths.workspaceId,context.workspace.id),eq(usageMonths.month,month))).limit(1).then((rows)=>rows[0]),
  ]);
  const accepted=usage?.acceptedEmails??0;
  const estimate=accepted*0.0025;
  const checkoutEnabled=isFeatureEnabled("LIVE_CHECKOUT_ENABLED");
  return <DashboardPage title="Facturation" description="Abonnement privé et emails acceptés pour livraison."><div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]"><article className="rounded-2xl border bg-white p-6"><div className="flex justify-between"><div><Badge>Bêta privée</Badge><p className="mt-3 text-3xl font-semibold">29 € / mois</p><p className="mt-2 text-sm text-muted-foreground">2 domaines · 3 membres · aucun email inclus</p><p className="mt-1 text-sm text-muted-foreground">Statut Stripe : {subscription?.status??"inactive"}</p>{subscription?.pilotAccessExpiresAt && <p className="mt-1 text-sm text-muted-foreground">Accès pilote interne jusqu’au {subscription.pilotAccessExpiresAt.toLocaleString("fr-FR")}</p>}</div><CreditCard className="text-primary"/></div><div className="mt-8 rounded-xl bg-zinc-50 p-5"><div className="flex justify-between text-sm"><span>{accepted.toLocaleString("fr-FR")} emails acceptés</span><strong>{estimate.toFixed(2).replace(".",",")} €</strong></div><p className="mt-2 text-xs text-muted-foreground">2,50 € par tranche de 1 000, mesuré à 0,0025 € par email sans arrondi par requête. TVA appliquée selon le régime fiscal en vigueur.</p></div></article><article className="rounded-2xl border bg-white p-6"><h2 className="font-semibold">Gérer l’abonnement</h2>{subscription?.stripeCustomerId?<form action={portalAction}><Button className="mt-6" type="submit" variant="outline">Ouvrir le portail Stripe</Button></form>:context.workspace.status === "approved"&&checkoutEnabled?<><p className="mt-3 text-sm text-muted-foreground">Votre dossier est approuvé. Ce checkout privé active l’accès plateforme et la mesure à l’usage.</p><form action={checkoutAction}><Button className="mt-6" type="submit">Finaliser l’abonnement</Button></form></>:context.workspace.status === "approved"?<p className="mt-3 text-sm text-muted-foreground">La souscription ouvrira après la certification finale de la facturation.</p>:<p className="mt-3 text-sm text-muted-foreground">L’abonnement devient accessible après approbation du dossier. Aucun checkout public n’est proposé.</p>}</article></div></DashboardPage>;
}
