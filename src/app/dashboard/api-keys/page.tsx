import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import { ApiKeyForm } from "@/components/api-key-form";
import { ConfirmAction } from "@/components/confirm-action";
import { DashboardPage } from "@/components/dashboard-page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireDb } from "@/db";
import { apiKeys } from "@/db/schema";
import { revokeApiKeyAction } from "@/features/api-key/actions";
import { apiKeyAvailability } from "@/features/api-key/availability";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { localeCode, statusLabel } from "@/i18n/format";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Clés API", en: "API keys" }) };
}

export default async function Page() {
  const locale = await getLocale();
  const formatLocale = localeCode(locale);
  const copy = localized(locale, { fr: { title: "Clés API", description: "Les secrets sont affichés une fois, hashés et révocables instantanément.", used: "utilisée le", never: "jamais utilisée", revoked: "Révoquée", revoke: "Révoquer", confirmTitle: "Révoquer cette clé ?", confirmText: "Les appels utilisant cette clé seront refusés immédiatement. Cette action est définitive.", confirm: "Révoquer la clé", pending: "Révocation…", cancel: "Annuler", empty: "Aucune clé API." }, en: { title: "API keys", description: "Secrets are shown once, hashed, and can be revoked instantly.", used: "used on", never: "never used", revoked: "Revoked", revoke: "Revoke", confirmTitle: "Revoke this key?", confirmText: "Calls using this key will be refused immediately. This cannot be undone.", confirm: "Revoke key", pending: "Revoking…", cancel: "Cancel", empty: "No API keys." } });
  const context = await requirePageWorkspace();
  const canManage = ["owner", "admin"].includes(context.role);
  const keys = await requireDb().select().from(apiKeys).where(eq(apiKeys.workspaceId, context.workspace.id)).orderBy(desc(apiKeys.createdAt));
  return (
    <DashboardPage title={copy.title} description={copy.description}>
      <ApiKeyForm availability={apiKeyAvailability(context.workspace)} canManage={canManage} locale={locale} />
      <div className="mt-6 rounded-md border bg-card ">
        {keys.map((key) => (
          <div className="grid grid-cols-[1fr_auto] gap-4 border-b p-5 last:border-0 sm:grid-cols-5" key={key.id}>
            <div><p className="font-medium">{key.name}</p><p className="font-mono text-xs text-muted-foreground">{key.prefix}…</p></div>
            <Badge className="w-fit" variant={key.mode === "live" ? "default" : "secondary"}>{statusLabel(locale,key.mode)}</Badge>
            <p className="hidden text-sm text-muted-foreground sm:col-span-2 sm:block">{key.scopes.join(", ")} · {key.lastUsedAt ? `${copy.used} ${new Intl.DateTimeFormat(formatLocale).format(key.lastUsedAt)}` : copy.never}</p>
            <div>{key.revokedAt
              ? <Button disabled size="sm" type="button" variant="outline">{copy.revoked}</Button>
              : <ConfirmAction action={revokeApiKeyAction.bind(null, key.id)} cancelLabel={copy.cancel} confirmLabel={copy.confirm} description={copy.confirmText} disabled={!canManage} pendingLabel={copy.pending} title={copy.confirmTitle} trigger={copy.revoke} />}</div>
          </div>
        ))}
        {!keys.length && <p className="p-8 text-center text-sm text-muted-foreground">{copy.empty}</p>}
      </div>
    </DashboardPage>
  );
}
