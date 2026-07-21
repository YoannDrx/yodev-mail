"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createApiKeyFormAction } from "@/features/api-key/actions";

export function ApiKeyForm() {
  const [state, action, pending] = useActionState(createApiKeyFormAction, { token: "", error: "" });
  return <div className="rounded-2xl border bg-white p-5 shadow-sm"><form action={action} className="grid gap-4 md:grid-cols-[1fr_140px_1fr_auto]"><Input name="name" placeholder="Production VigieAds" required /><select className="h-9 rounded-md border bg-transparent px-3 text-sm" name="mode"><option value="test">Test</option><option value="live">Live</option></select><div className="flex flex-wrap items-center gap-3 text-sm">{["emails:send","emails:read","webhooks:manage"].map((scope)=><label className="flex gap-1.5" key={scope}><input defaultChecked={scope!=="webhooks:manage"} name="scopes" type="checkbox" value={scope}/>{scope}</label>)}</div><Button disabled={pending} type="submit"><Plus />Créer</Button></form>{state.token&&<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-medium text-amber-900">Copiez cette clé maintenant : elle ne sera plus affichée.</p><code className="mt-2 block break-all text-xs">{state.token}</code></div>}{state.error&&<p className="mt-3 text-sm text-destructive">{state.error}</p>}</div>;
}
