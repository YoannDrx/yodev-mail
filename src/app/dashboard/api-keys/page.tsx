import { desc, eq } from "drizzle-orm";
import { DashboardPage } from "@/components/dashboard-page";
import { ApiKeyForm } from "@/components/api-key-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { revokeApiKeyAction } from "@/features/api-key/actions";
import { requirePageWorkspace } from "@/lib/page-auth";

export default async function Page(){const context=await requirePageWorkspace();const keys=context?await requireDb().select().from(apiKeys).where(eq(apiKeys.workspaceId,context.workspace.id)).orderBy(desc(apiKeys.createdAt)):[];return <DashboardPage title="Clés API" description="Les secrets sont affichés une fois, hashés et révocables instantanément."><ApiKeyForm/><div className="mt-6 rounded-2xl border bg-white shadow-sm">{keys.map((key)=><div className="grid grid-cols-[1fr_auto] gap-4 border-b p-5 last:border-0 sm:grid-cols-5" key={key.id}><div><p className="font-medium">{key.name}</p><p className="text-xs text-muted-foreground">{key.prefix}…</p></div><Badge className="w-fit" variant={key.mode==="live"?"default":"secondary"}>{key.mode}</Badge><p className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">{key.scopes.join(", ")} · {key.lastUsedAt?`utilisée ${new Intl.DateTimeFormat("fr-FR").format(key.lastUsedAt)}`:"jamais utilisée"}</p><form action={revokeApiKeyAction.bind(null,key.id)}><Button disabled={Boolean(key.revokedAt)} size="sm" type="submit" variant="outline">{key.revokedAt?"Révoquée":"Révoquer"}</Button></form></div>)}{!keys.length&&<p className="p-8 text-center text-sm text-muted-foreground">Aucune clé API.</p>}</div></DashboardPage>}
