"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createApiKeyFormAction } from "@/features/api-key/actions";
import type { Locale } from "@/i18n/config";
import { localized } from "@/i18n/config";

export function ApiKeyForm({ allowRaw, locale }: { allowRaw: boolean; locale: Locale }) {
  const [state, action, pending] = useActionState(createApiKeyFormAction, { token: "", error: "" });
  const scopes = ["emails:send", "emails:read", "attachments:write", ...(allowRaw ? ["emails:send:raw"] : [])];
  const copy = localized(locale, { fr: { placeholder: "Production Yodev", create: "Créer", once: "Copiez cette clé maintenant : elle ne sera plus affichée." }, en: { placeholder: "Yodev production", create: "Create", once: "Copy this key now: it will not be displayed again." } });
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><form action={action} className="grid gap-4 md:grid-cols-[1fr_140px_1fr_auto]"><Input name="name" placeholder={copy.placeholder} required /><select className="h-9 rounded-md border bg-transparent px-3 text-sm" name="mode"><option value="test">Test</option><option value="live">Live</option></select><div className="flex flex-wrap items-center gap-3 text-sm">{scopes.map((scope)=><label className="flex gap-1.5" key={scope}><input defaultChecked={scope!=="emails:send:raw"} name="scopes" type="checkbox" value={scope}/>{scope}</label>)}</div><Button disabled={pending} type="submit"><Plus />{copy.create}</Button></form>{state.token&&<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-medium text-amber-900">{copy.once}</p><code className="mt-2 block break-all text-xs">{state.token}</code></div>}{state.error&&<p className="mt-3 text-sm text-destructive">{state.error}</p>}</div>;
}
