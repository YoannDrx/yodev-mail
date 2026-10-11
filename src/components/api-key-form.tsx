"use client";

import { useActionState } from "react";
import { Plus } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { describedBy } from "@/components/form-field";
import { FieldError, FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createApiKeyFormAction, type ApiKeyFormState } from "@/features/api-key/actions";
import type { ApiKeyAvailability } from "@/features/api-key/availability";
import type { Locale } from "@/i18n/config";
import { localized } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function ApiKeyForm({ availability, canManage, locale }: { availability: ApiKeyAvailability; canManage: boolean; locale: Locale }) {
  const [state, action, pending] = useActionState(createApiKeyFormAction, initialActionState() as ApiKeyFormState);
  const copy = localized(locale, {
    fr: { name: "Nom de la clé", placeholder: "Backend de production", mode: "Mode", test: "Test (envois simulés)", live: "Live", scopes: "Permissions", create: "Créer la clé", pending: "Création…", once: "Copiez cette clé maintenant : elle ne sera plus affichée.", copy: "Copier la clé", copied: "Clé copiée", liveGate: "Live indisponible : les envois live ne sont pas encore ouverts sur la plateforme.", liveWorkspace: "Live disponible après l’approbation du workspace par Yodev.", admin: "Seuls les propriétaires et administrateurs peuvent créer une clé.", scopeLabels: { "emails:send": "emails:send — envoyer", "emails:read": "emails:read — consulter les statuts", "attachments:write": "attachments:write — téléverser des pièces jointes", "emails:send:raw": "emails:send:raw — envoyer du HTML brut" } },
    en: { name: "Key name", placeholder: "Production backend", mode: "Mode", test: "Test (simulated sends)", live: "Live", scopes: "Permissions", create: "Create key", pending: "Creating…", once: "Copy this key now: it will not be displayed again.", copy: "Copy key", copied: "Key copied", liveGate: "Live unavailable: live sending is not open on the platform yet.", liveWorkspace: "Live becomes available once Yodev approves the workspace.", admin: "Only owners and administrators can create a key.", scopeLabels: { "emails:send": "emails:send — send", "emails:read": "emails:read — read statuses", "attachments:write": "attachments:write — upload attachments", "emails:send:raw": "emails:send:raw — send raw HTML" } },
  });
  // attachments:write is never pre-checked and only offered once the gate is open.
  type Scope = { value: keyof typeof copy.scopeLabels; checked: boolean };
  const scopes: Scope[] = [
    { value: "emails:send", checked: true },
    { value: "emails:read", checked: true },
    ...(availability.attachments ? [{ value: "attachments:write", checked: false } satisfies Scope] : []),
    ...(availability.raw ? [{ value: "emails:send:raw", checked: false } satisfies Scope] : []),
  ];
  const liveHint = availability.live ? "" : availability.liveReason === "workspace" ? copy.liveWorkspace : copy.liveGate;
  const submittedScopes = state.values.scopes === undefined ? null : state.values.scopes.split(",");
  const nameErrors = state.fieldErrors.name;
  const modeErrors = state.fieldErrors.mode;
  const scopeErrors = state.fieldErrors.scopes;
  return <div className="rounded-md border bg-card p-5 ">
    {!canManage ? <p className="mb-4 text-sm text-muted-foreground">{copy.admin}</p> : null}
    <form action={action} aria-busy={pending} className="grid gap-5 md:grid-cols-[1fr_220px]">
      <div className="grid gap-2">
        <Label htmlFor="api-key-name">{copy.name}</Label>
        <Input aria-describedby={describedBy("api-key-name", false, Boolean(nameErrors?.length))} aria-invalid={nameErrors?.length ? true : undefined} className="h-10" defaultValue={state.values.name} disabled={!canManage} id="api-key-name" maxLength={120} minLength={2} name="name" placeholder={copy.placeholder} required />
        <FieldError errors={nameErrors} id="api-key-name-error" />
      </div>
      <div className="grid content-start gap-2">
        <Label htmlFor="api-key-mode">{copy.mode}</Label>
        <select aria-describedby={[liveHint ? "api-key-mode-hint" : "", modeErrors?.length ? "api-key-mode-error" : ""].filter(Boolean).join(" ") || undefined} aria-invalid={modeErrors?.length ? true : undefined} className="h-10 rounded-md border bg-card px-3 text-sm" defaultValue={state.values.mode ?? "test"} disabled={!canManage} id="api-key-mode" key={state.values.mode ?? "test"} name="mode">
          <option value="test">{copy.test}</option>
          <option disabled={!availability.live} value="live">{copy.live}</option>
        </select>
        {liveHint ? <p className="text-xs text-muted-foreground" id="api-key-mode-hint">{liveHint}</p> : null}
        <FieldError errors={modeErrors} id="api-key-mode-error" />
      </div>
      <fieldset aria-describedby={scopeErrors?.length ? "api-key-scopes-error" : undefined} className="grid gap-2 md:col-span-2">
        <legend className="mb-2 text-sm font-medium">{copy.scopes}</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {scopes.map((scope) => <label className="flex items-center gap-2" key={scope.value}><input defaultChecked={submittedScopes ? submittedScopes.includes(scope.value) : scope.checked} disabled={!canManage} name="scopes" type="checkbox" value={scope.value} /><span className="font-mono text-xs">{copy.scopeLabels[scope.value]}</span></label>)}
        </div>
        <FieldError errors={scopeErrors} id="api-key-scopes-error" />
      </fieldset>
      <div className="grid gap-3 md:col-span-2">
        <FormStatus message={state.message} ok={state.ok} />
        <Button className="h-10 w-fit" disabled={pending || !canManage} type="submit"><Plus />{pending ? copy.pending : copy.create}</Button>
      </div>
    </form>
    {state.ok && state.data?.token ? <div className="mt-4 rounded-md border y-status-warning p-4">
      <p className="text-sm font-medium text-[var(--y-warning)]">{copy.once}</p>
      <code className="mt-2 block break-all text-xs">{state.data.token}</code>
      <div className="mt-3"><CopyButton copiedLabel={copy.copied} label={copy.copy} value={state.data.token} /></div>
    </div> : null}
  </div>;
}
