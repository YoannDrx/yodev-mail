import { desc, eq } from "drizzle-orm";
import { DashboardPage } from "@/components/dashboard-page";
import { WebhookForm } from "@/components/webhook-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireDb } from "@/db";
import { webhookEndpoints } from "@/db/schema";
import { toggleWebhookAction } from "@/features/webhooks/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
export default async function Page(){const context=await requirePageWorkspace();const rows=context?await requireDb().select().from(webhookEndpoints).where(eq(webhookEndpoints.workspaceId,context.workspace.id)).orderBy(desc(webhookEndpoints.createdAt)):[];return <DashboardPage title="Webhooks" description="Événements signés, retries SQS et journal technique."><WebhookForm/><div className="mt-6 grid gap-4">{rows.map((endpoint)=><article className="rounded-2xl border bg-white p-6" key={endpoint.id}><div className="flex flex-col justify-between gap-4 sm:flex-row"><div><div className="flex gap-2"><h2 className="break-all font-mono text-sm">{endpoint.url}</h2><Badge variant={endpoint.enabled?"default":"secondary"}>{endpoint.enabled?"Actif":"Désactivé"}</Badge></div><p className="mt-2 text-sm text-muted-foreground">{endpoint.eventTypes.join(" · ")}</p></div><form action={toggleWebhookAction.bind(null,endpoint.id)}><Button type="submit" variant="outline">{endpoint.enabled?"Désactiver":"Activer"}</Button></form></div></article>)}{!rows.length&&<p className="rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">Aucun webhook.</p>}</div></DashboardPage>}
