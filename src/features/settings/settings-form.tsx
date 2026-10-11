"use client";

import { useActionState } from "react";
import { FieldError, FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSettingsAction } from "@/features/settings/actions";
import { localized, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

type Settings = {
  companyName: string | null;
  companyAddress: string | null;
  defaultFromName: string | null;
  defaultReplyTo: string | null;
};

export function SettingsForm({ locale, settings, canEdit }: { locale: Locale; settings: Settings; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateSettingsAction, initialActionState());
  const copy = localized(locale, {
    fr: { identity: "Identité de l’expéditeur", company: "Raison sociale", address: "Adresse postale", from: "Nom d’expéditeur par défaut", reply: "Adresse de réponse (Reply-To) par défaut", save: "Enregistrer", pending: "Enregistrement…", readOnly: "Seuls les propriétaires et administrateurs du workspace peuvent modifier ces informations." },
    en: { identity: "Sender identity", company: "Legal business name", address: "Postal address", from: "Default sender name", reply: "Default Reply-To address", save: "Save", pending: "Saving…", readOnly: "Only workspace owners and administrators can change these details." },
  });
  const fields = [
    { name: "companyName", label: copy.company, type: "text", autoComplete: "organization" },
    { name: "companyAddress", label: copy.address, type: "text", autoComplete: "street-address" },
    { name: "defaultFromName", label: copy.from, type: "text", autoComplete: "off" },
    { name: "defaultReplyTo", label: copy.reply, type: "email", autoComplete: "email" },
  ] as const;
  return (
    <form action={action} className="rounded-md border bg-card p-6">
      <h2 className="font-semibold">{copy.identity}</h2>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {fields.map((field) => {
          const errors = state.fieldErrors[field.name];
          return (
            <div className="grid gap-2" key={field.name}>
              <Label htmlFor={`settings-${field.name}`}>{field.label}</Label>
              <Input
                aria-describedby={errors ? `settings-${field.name}-error` : undefined}
                aria-invalid={errors ? true : undefined}
                autoComplete={field.autoComplete}
                defaultValue={state.values[field.name] ?? settings[field.name] ?? ""}
                disabled={!canEdit}
                id={`settings-${field.name}`}
                name={field.name}
                type={field.type}
              />
              <FieldError id={`settings-${field.name}-error`} errors={errors} />
            </div>
          );
        })}
      </div>
      {canEdit ? (
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <Button disabled={pending} type="submit">{pending ? copy.pending : copy.save}</Button>
          <FormStatus message={state.message} ok={state.ok} />
        </div>
      ) : (
        <p className="mt-5 text-sm text-muted-foreground">{copy.readOnly}</p>
      )}
    </form>
  );
}
