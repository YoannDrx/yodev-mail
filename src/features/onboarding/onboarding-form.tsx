"use client";

import { useActionState } from "react";
import { Check } from "lucide-react";
import { FieldError, FormStatus } from "@/components/form-status";
import { TextAreaField, TextField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { completeOnboardingAction } from "@/features/onboarding/actions";
import { onboardingLimits, volumeLimits } from "@/features/onboarding/schema";
import { localized, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function OnboardingForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(completeOnboardingAction, initialActionState());
  const copy = localized(locale, {
    fr: {
      company: "Identité légale", application: "Application concernée", address: "Adresse professionnelle", website: "Site public", domains: "Domaines ou sous-domaines d’envoi", domainsHint: "Un domaine par ligne ou séparés par des virgules.", categories: "Catégories transactionnelles", categoriesPlaceholder: "Réinitialisation de mot de passe, reçu de paiement…", trigger: "Événement déclencheur précis", relationship: "Relation avec les destinataires", monthly: "Volume mensuel", daily: "Moyenne quotidienne", peak: "Pic quotidien", examples: "Exemples de sujets et contenus", errors: "Gestion des erreurs et destinataires invalides", abuse: "J’accepte la politique anti-abus.", strict: "Le produit est strictement transactionnel.", submit: "Envoyer pour validation", pending: "Envoi du dossier…", attestations: "Attestations",
      min: (value: number) => `${value} caractères minimum.`,
      list: [["noPurchasedLists", "Aucune liste achetée, louée ou scrapée."], ["noColdEmail", "Aucun cold email."], ["noNewsletter", "Aucune newsletter."], ["noMarketing", "Aucun message promotionnel."], ["noCircumvention", "Aucun contournement d’une suspension."], ["suspensionAccepted", "Yodev peut suspendre immédiatement un usage risqué."]] as const,
    },
    en: {
      company: "Legal identity", application: "Application", address: "Business address", website: "Public website", domains: "Sending domains or subdomains", domainsHint: "One domain per line or comma-separated.", categories: "Transactional categories", categoriesPlaceholder: "Password reset, payment receipt…", trigger: "Exact triggering event", relationship: "Relationship with recipients", monthly: "Monthly volume", daily: "Daily average", peak: "Daily peak", examples: "Example subjects and content", errors: "Error and invalid-recipient handling", abuse: "I accept the anti-abuse policy.", strict: "The product is strictly transactional.", submit: "Submit for review", pending: "Submitting…", attestations: "Attestations",
      min: (value: number) => `At least ${value} characters.`,
      list: [["noPurchasedLists", "No purchased, rented, or scraped lists."], ["noColdEmail", "No cold email."], ["noNewsletter", "No newsletters."], ["noMarketing", "No promotional messages."], ["noCircumvention", "No attempt to circumvent a suspension."], ["suspensionAccepted", "Yodev may immediately suspend risky usage."]] as const,
    },
  });
  const limit = (field: keyof typeof onboardingLimits) => ({ minLength: onboardingLimits[field].min, maxLength: onboardingLimits[field].max });
  const longText = (field: keyof typeof onboardingLimits) => ({ ...limit(field), hint: copy.min(onboardingLimits[field].min) });
  const volume = { type: "number", min: volumeLimits.min, max: volumeLimits.max };
  const checked = (name: string) => state.values[name] === "on";
  return (
    <form action={action} aria-busy={pending} className="mt-8 grid gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={copy.company} name="companyName" state={state} {...limit("companyName")} />
        <TextField label={copy.application} name="applicationName" state={state} {...limit("applicationName")} />
      </div>
      <TextField label={copy.address} name="companyAddress" state={state} {...limit("companyAddress")} />
      <TextField label={copy.website} maxLength={500} name="websiteUrl" placeholder="https://" state={state} type="url" />
      <TextAreaField hint={copy.domainsHint} label={copy.domains} name="domainNames" placeholder="notifications.client.com" state={state} {...limit("domainNames")} />
      <TextAreaField label={copy.categories} name="categories" placeholder={copy.categoriesPlaceholder} state={state} {...limit("categories")} />
      <TextAreaField label={copy.trigger} name="triggerDescription" state={state} {...longText("triggerDescription")} />
      <TextAreaField label={copy.relationship} name="recipientRelationship" state={state} {...longText("recipientRelationship")} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label={copy.monthly} name="expectedMonthlyVolume" state={state} {...volume} />
        <TextField label={copy.daily} name="averageDailyVolume" state={state} {...volume} />
        <TextField label={copy.peak} name="dailyPeakVolume" state={state} {...volume} />
      </div>
      <TextAreaField label={copy.examples} name="exampleContent" state={state} {...longText("exampleContent")} />
      <TextAreaField label={copy.errors} name="errorPolicy" state={state} {...longText("errorPolicy")} />
      <fieldset className="grid gap-2 rounded-md border p-5">
        <legend className="px-1 text-sm font-medium">{copy.attestations}</legend>
        {copy.list.map(([name, label]) => <Attestation checked={checked(name)} errors={state.fieldErrors[name]} key={name} name={name}><span>{label}</span></Attestation>)}
      </fieldset>
      <div className="rounded-md border p-4 text-sm">
        <Attestation checked={checked("abuseAccepted")} errors={state.fieldErrors.abuseAccepted} name="abuseAccepted"><span><strong>{copy.abuse}</strong><br /><span className="text-muted-foreground">{copy.strict}</span></span></Attestation>
      </div>
      <FormStatus message={state.message} ok={state.ok} />
      <Button className="mt-2 h-10 w-fit" disabled={pending} type="submit">{pending ? copy.pending : copy.submit} <Check /></Button>
    </form>
  );
}

function Attestation({ name, checked, errors, children }: { name: string; checked: boolean; errors?: string[]; children: React.ReactNode }) {
  const errorId = `${name}-error`;
  return <div className="grid gap-1">
    <label className="flex gap-3 text-sm">
      <input aria-describedby={errors?.length ? errorId : undefined} aria-invalid={errors?.length ? true : undefined} defaultChecked={checked} name={name} required type="checkbox" />
      {children}
    </label>
    <FieldError errors={errors} id={errorId} />
  </div>;
}
