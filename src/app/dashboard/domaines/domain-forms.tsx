"use client";

import { useActionState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { FormStatus } from "@/components/form-status";
import { describedBy } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDomainAction, refreshDomainAction } from "@/features/domains/actions";
import { domainPattern } from "@/features/domains/schema";
import { localized, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function AddDomainForm({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [state, action, pending] = useActionState(addDomainAction, initialActionState());
  const copy = localized(locale, {
    fr: { domain: "Domaine d’envoi", add: "Ajouter", pending: "Ajout…", hint: "Nom complet, sans https:// (ex. notifications.client.com).", admin: "Seuls les propriétaires et administrateurs peuvent ajouter un domaine." },
    en: { domain: "Sending domain", add: "Add", pending: "Adding…", hint: "Full name, without https:// (e.g. notifications.client.com).", admin: "Only owners and administrators can add a domain." },
  });
  const errors = state.fieldErrors.domain;
  return <form action={action} aria-busy={pending} className="grid w-full max-w-md gap-2">
    <Label htmlFor="domain">{copy.domain}</Label>
    <div className="flex gap-2">
      <Input
        aria-describedby={describedBy("domain", true, Boolean(errors?.length))}
        aria-invalid={errors?.length ? true : undefined}
        autoCapitalize="none"
        className="h-10"
        defaultValue={state.values.domain}
        disabled={!canManage}
        id="domain"
        maxLength={253}
        name="domain"
        pattern={domainPattern}
        placeholder="notifications.client.com"
        required
      />
      <Button className="h-10" disabled={pending || !canManage} type="submit"><Plus />{pending ? copy.pending : copy.add}</Button>
    </div>
    <p className="text-xs text-muted-foreground" id="domain-hint">{canManage ? copy.hint : copy.admin}</p>
    {/* Single-field form: the announced status doubles as the field's description. */}
    <div id="domain-error"><FormStatus message={state.message} ok={state.ok} /></div>
  </form>;
}

export function RecheckDomainButton({ domainId, locale, provisioned, canManage }: { domainId: string; locale: Locale; provisioned: boolean; canManage: boolean }) {
  const [state, action, pending] = useActionState(refreshDomainAction.bind(null, domainId), initialActionState());
  const copy = localized(locale, {
    fr: { recheck: "Revérifier", pending: "Vérification…", notProvisioned: "Disponible dès que Yodev a préparé les enregistrements DNS.", admin: "Réservé aux propriétaires et administrateurs." },
    en: { recheck: "Check again", pending: "Checking…", notProvisioned: "Available once Yodev has prepared the DNS records.", admin: "Restricted to owners and administrators." },
  });
  const blocked = !provisioned ? copy.notProvisioned : !canManage ? copy.admin : "";
  const hintId = `recheck-${domainId}-hint`;
  return <form action={action} className="grid max-w-64 justify-items-start gap-2 sm:justify-items-end">
    <Button aria-describedby={blocked ? hintId : undefined} disabled={pending || Boolean(blocked)} type="submit" variant="outline"><RefreshCw />{pending ? copy.pending : copy.recheck}</Button>
    {blocked ? <p className="text-xs text-muted-foreground sm:text-right" id={hintId}>{blocked}</p> : null}
    <FormStatus className="sm:text-right" message={state.message} ok={state.ok} />
  </form>;
}
