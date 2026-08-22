import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
import { ApiKeyForm } from "@/components/api-key-form";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { revokeApiKeyAction } from "@/features/api-key/actions";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, { fr: { title: "Clés API", description: "Les secrets sont affichés une fois, hashés et révocables instantanément.", used: "utilisée", never: "jamais utilisée", revoked: "Révoquée", revoke: "Révoquer", empty: "Aucune clé API." }, en: { title: "API keys", description: "Secrets are shown once, hashed, and can be revoked instantly.", used: "used", never: "never used", revoked: "Revoked", revoke: "Revoke", empty: "No API keys." } });
  const context = await requirePageWorkspace();
  const keys = context
    ? await requireDb().select().from(apiKeys).where(eq(apiKeys.workspaceId, context.workspace.id)).orderBy(desc(apiKeys.createdAt))
    : [];
  return (
    <DashboardPage title={copy.title} description={copy.description}>
      <ApiKeyForm allowRaw={Boolean(context?.workspace.contentPolicy === "hybrid")} locale={locale} />
      <div className="mt-6 rounded-2xl border bg-white shadow-sm">
        {keys.map((key) => (
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b p-5 last:border-0 sm:grid-cols-5" key={key.id}>
            <div><p className="font-medium">{key.name}</p><p className="text-xs text-muted-foreground">{key.prefix}…</p></div>
            <Badge className="w-fit" variant={key.mode === "live" ? "default" : "secondary"}>{statusLabel(locale,key.mode)}</Badge>
            <p className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">{key.scopes.join(", ")} · {key.lastUsedAt ? `${copy.used} ${new Intl.DateTimeFormat(formatLocale).format(key.lastUsedAt)}` : copy.never}</p>
            <form action={revokeApiKeyAction.bind(null, key.id)}><Button disabled={Boolean(key.revokedAt)} size="sm" type="submit" variant="outline">{key.revokedAt ? copy.revoked : copy.revoke}</Button></form>
          </div>
        ))}
        {!keys.length && <p className="p-8 text-center text-sm text-muted-foreground">{copy.empty}</p>}
      </div>
    </DashboardPage>
  );
}
