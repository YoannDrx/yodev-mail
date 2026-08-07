"use client";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWebhookFormAction } from "@/features/webhooks/actions";
export function WebhookForm(){const [state,action,pending]=useActionState(createWebhookFormAction,{secret:"",error:""});return <div className="rounded-2xl border bg-white p-5"><form action={action} className="grid gap-4"><Input name="url" placeholder="https://client.fr/webhooks/yodev-mail" type="url" required/><div className="flex flex-wrap gap-4 text-sm">{["sent","delivered","bounced","complained","failed","suppressed"].map((event)=><label className="flex gap-1.5" key={event}><input defaultChecked name="eventTypes" type="checkbox" value={event}/>{event}</label>)}</div><Button className="w-fit" disabled={pending} type="submit"><Plus/>Ajouter l’endpoint</Button></form>{state.secret&&<div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><strong>Secret affiché une seule fois</strong><code className="mt-2 block break-all text-xs">{state.secret}</code></div>}{state.error&&<p className="mt-3 text-sm text-destructive">{state.error}</p>}</div>}
