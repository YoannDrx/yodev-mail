"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { TextAreaField, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { createTransactionalProfileAction } from "@/features/profiles/actions";
import { profileKeyPattern, profileLimits } from "@/features/profiles/schema";
import { localized, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function ProfileForm({ locale, canManage }: { locale: Locale; canManage: boolean }) {
  const [state, action, pending] = useActionState(createTransactionalProfileAction, initialActionState());
  const copy = localized(locale, {
    fr: { key: "Clé de catégorie (champ category de l’API)", keyHint: "Minuscules, chiffres et _ ; commence par une lettre.", name: "Nom", namePlaceholder: "Reçu de paiement", volume: "Volume mensuel estimé", trigger: "Événement déclencheur", relationship: "Relation avec le destinataire", content: "Exemple de contenu", submit: "Soumettre à validation", pending: "Envoi…", min: (value: number) => `${value} caractères minimum.`, admin: "Seuls les propriétaires et administrateurs peuvent déclarer un cas d’usage." },
    en: { key: "Category key (API category field)", keyHint: "Lowercase letters, digits and _; starts with a letter.", name: "Name", namePlaceholder: "Payment receipt", volume: "Estimated monthly volume", trigger: "Triggering event", relationship: "Relationship with the recipient", content: "Content example", submit: "Submit for review", pending: "Submitting…", min: (value: number) => `At least ${value} characters.`, admin: "Only owners and administrators can declare a use case." },
  });
  const long = (field: keyof typeof profileLimits) => ({ minLength: profileLimits[field].min, maxLength: profileLimits[field].max, hint: copy.min(profileLimits[field].min), className: "md:col-span-2", disabled: !canManage });
  return <form action={action} aria-busy={pending} className="mb-8 grid gap-5 rounded-md border bg-card p-6 md:grid-cols-2">
    {!canManage ? <p className="text-sm text-muted-foreground md:col-span-2">{copy.admin}</p> : null}
    <TextField disabled={!canManage} hint={copy.keyHint} label={copy.key} maxLength={80} name="key" pattern={profileKeyPattern} placeholder="payment_receipt" state={state} />
    <TextField disabled={!canManage} label={copy.name} maxLength={profileLimits.name.max} minLength={profileLimits.name.min} name="name" placeholder={copy.namePlaceholder} state={state} />
    <TextField disabled={!canManage} label={copy.volume} max={10_000_000} min={1} name="expectedMonthlyVolume" state={state} type="number" />
    <TextAreaField label={copy.trigger} name="triggerDescription" state={state} {...long("triggerDescription")} />
    <TextAreaField label={copy.relationship} name="recipientRelationship" state={state} {...long("recipientRelationship")} />
    <TextAreaField label={copy.content} name="contentExample" state={state} {...long("contentExample")} />
    <div className="grid gap-3 md:col-span-2">
      <FormStatus message={state.message} ok={state.ok} />
      <Button className="h-10 w-fit" disabled={pending || !canManage} type="submit">{pending ? copy.pending : copy.submit}</Button>
    </div>
  </form>;
}
