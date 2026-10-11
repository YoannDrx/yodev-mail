import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { DashboardPage } from "@/components/dashboard-page";
import { WebhookEndpointActions, WebhookForm } from "@/components/webhook-form";
import { Badge } from "@/components/ui/badge";
import { requireDb } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { isFeatureEnabled } from "@/lib/env";
import { requirePageWorkspace } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocale()) === "fr" ? "Webhooks du workspace" : "Workspace webhooks" };
}

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: {
      description: "Événements signés, nouvelles tentatives automatiques et journal technique.",
      offTitle: "Livraison désactivée pour l’instant",
      offBody: "Vous pouvez déjà enregistrer et préparer vos endpoints, mais aucun événement ne leur est envoyé tant que Yodev n’a pas ouvert la livraison des webhooks. Les événements produits pendant cette période ne seront pas renvoyés ensuite.",
      active: "Actif",
      paused: "Livraison désactivée",
      disabled: "Désactivé",
      empty: "Aucun webhook.",
    },
    en: {
      description: "Signed events, automatic retries and technical delivery log.",
      offTitle: "Delivery turned off for now",
      offBody: "You can already register and prepare your endpoints, but no event is sent to them until Yodev opens webhook delivery. Events produced in the meantime will not be sent afterwards.",
      active: "Active",
      paused: "Delivery off",
      disabled: "Disabled",
      empty: "No webhooks.",
    },
  });
  const deliveryEnabled = isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED");
  const context = await requirePageWorkspace();
  const rows = context
    ? await requireDb().select().from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId, context.workspace.id)).orderBy(desc(webhookEndpoints.createdAt))
    : [];
  return (
    <DashboardPage title="Webhooks" description={copy.description}>
      {!deliveryEnabled && (
        <section aria-labelledby="webhook-delivery-off" className="mb-6 rounded-md y-status-warning p-4 text-sm text-[var(--y-warning)]">
          <h2 className="font-semibold" id="webhook-delivery-off">{copy.offTitle}</h2>
          <p className="mt-1">{copy.offBody}</p>
        </section>
      )}
      <WebhookForm locale={locale} />
      <div className="mt-6 grid gap-4">
        {rows.map((endpoint) => {
          const status = !endpoint.enabled ? copy.disabled : deliveryEnabled ? copy.active : copy.paused;
          return (
            <article className="rounded-md border bg-card p-6" key={endpoint.id}>
              <div className="flex flex-col justify-between gap-4 sm:flex-row">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-all font-mono text-sm">{endpoint.url}</h2>
                    <Badge variant={endpoint.enabled && deliveryEnabled ? "default" : "secondary"}>{status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{endpoint.eventTypes.join(" · ")}</p>
                </div>
                <WebhookEndpointActions deliveryEnabled={deliveryEnabled} enabled={endpoint.enabled} endpointId={endpoint.id} locale={locale} />
              </div>
            </article>
          );
        })}
        {!rows.length && <p className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground">{copy.empty}</p>}
      </div>
    </DashboardPage>
  );
}
