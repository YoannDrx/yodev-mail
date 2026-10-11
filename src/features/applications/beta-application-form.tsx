"use client";

import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2 } from "lucide-react";
import { FieldError, FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { submitBetaApplicationAction } from "@/features/applications/actions";
import {
  betaApplicationContactEmail,
  betaApplicationHoneypotField,
  maxExpectedMonthlyVolume,
} from "@/features/applications/constants";
import { localized, localizedPath, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function BetaApplicationForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(submitBetaApplicationAction, initialActionState());
  const copy = localized(locale, {
    fr: {
      company: "Entreprise",
      contactName: "Votre nom",
      workEmail: "Email professionnel",
      websiteUrl: "Site web",
      optional: "facultatif",
      useCase: "Quels emails transactionnels enverrez-vous ?",
      useCaseHint: "Par exemple : reçus de paiement, réinitialisation de mot de passe, notifications de compte.",
      volume: "Volume mensuel estimé",
      volumeHint: "Nombre d’emails par mois, même approximatif.",
      consent: "J’accepte que Yodev utilise ces informations pour étudier ma candidature et me répondre.",
      privacy: "Politique de confidentialité",
      honeypot: "Ne pas remplir",
      submit: "Envoyer ma candidature",
      pending: "Envoi…",
      thanks: "Candidature envoyée",
      back: "Retour à l’accueil",
      preferEmail: "Vous préférez écrire ?",
    },
    en: {
      company: "Company",
      contactName: "Your name",
      workEmail: "Work email",
      websiteUrl: "Website",
      optional: "optional",
      useCase: "Which transactional emails will you send?",
      useCaseHint: "For example: payment receipts, password resets, account notifications.",
      volume: "Expected monthly volume",
      volumeHint: "Emails per month, a rough estimate is fine.",
      consent: "I agree that Yodev uses this information to review my application and reply to me.",
      privacy: "Privacy policy",
      honeypot: "Leave empty",
      submit: "Send my application",
      pending: "Sending…",
      thanks: "Application sent",
      back: "Back to home",
      preferEmail: "Prefer email?",
    },
  });

  if (state.ok) {
    return (
      <div className="grid gap-3 rounded-md border bg-card p-6" role="status" aria-live="polite">
        <p className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="size-5 text-[var(--y-success)]" aria-hidden="true" />
          {copy.thanks}
        </p>
        <p className="text-sm leading-6 text-muted-foreground">{state.message}</p>
        <Button asChild className="mt-2 w-fit" variant="outline">
          <Link href={localizedPath(locale, "/")}>{copy.back}</Link>
        </Button>
      </div>
    );
  }

  const errors = state.fieldErrors;
  const field = (name: string) => ({
    id: `beta-${name}`,
    name,
    defaultValue: state.values[name] ?? "",
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `beta-${name}-error` : undefined,
  });

  return (
    <form action={action} className="grid gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="beta-company">{copy.company}</Label>
          <Input {...field("company")} autoComplete="organization" maxLength={180} required />
          <FieldError id="beta-company-error" errors={errors.company} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="beta-contactName">{copy.contactName}</Label>
          <Input {...field("contactName")} autoComplete="name" maxLength={140} required />
          <FieldError id="beta-contactName-error" errors={errors.contactName} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="beta-workEmail">{copy.workEmail}</Label>
          <Input {...field("workEmail")} autoComplete="email" maxLength={320} required type="email" />
          <FieldError id="beta-workEmail-error" errors={errors.workEmail} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="beta-websiteUrl">
            {copy.websiteUrl} <span className="font-normal text-muted-foreground">({copy.optional})</span>
          </Label>
          <Input {...field("websiteUrl")} autoComplete="url" placeholder="https://" type="url" />
          <FieldError id="beta-websiteUrl-error" errors={errors.websiteUrl} />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="beta-useCase">{copy.useCase}</Label>
        <p className="text-xs text-muted-foreground" id="beta-useCase-hint">{copy.useCaseHint}</p>
        <Textarea
          {...field("useCase")}
          aria-describedby={errors.useCase ? "beta-useCase-hint beta-useCase-error" : "beta-useCase-hint"}
          maxLength={2000}
          minLength={20}
          required
          rows={4}
        />
        <FieldError id="beta-useCase-error" errors={errors.useCase} />
      </div>
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor="beta-expectedMonthlyVolume">{copy.volume}</Label>
        <Input
          {...field("expectedMonthlyVolume")}
          aria-describedby={errors.expectedMonthlyVolume ? "beta-expectedMonthlyVolume-hint beta-expectedMonthlyVolume-error" : "beta-expectedMonthlyVolume-hint"}
          inputMode="numeric"
          max={maxExpectedMonthlyVolume}
          min={0}
          required
          step={1}
          type="number"
        />
        <p className="text-xs text-muted-foreground" id="beta-expectedMonthlyVolume-hint">{copy.volumeHint}</p>
        <FieldError id="beta-expectedMonthlyVolume-error" errors={errors.expectedMonthlyVolume} />
      </div>
      {/* Honeypot: hidden from people and assistive technology. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor={`beta-${betaApplicationHoneypotField}`}>{copy.honeypot}</label>
        <input autoComplete="off" id={`beta-${betaApplicationHoneypotField}`} name={betaApplicationHoneypotField} tabIndex={-1} type="text" />
      </div>
      <div className="grid gap-2">
        <label className="flex gap-3 text-sm leading-6" htmlFor="beta-consent">
          <input
            aria-describedby={errors.consent ? "beta-consent-error" : undefined}
            aria-invalid={errors.consent ? true : undefined}
            className="mt-1"
            id="beta-consent"
            name="consent"
            required
            type="checkbox"
          />
          <span>
            {copy.consent}{" "}
            <Link className="underline underline-offset-4" href={localizedPath(locale, "/confidentialite")}>{copy.privacy}</Link>
          </span>
        </label>
        <FieldError id="beta-consent-error" errors={errors.consent} />
      </div>
      <FormStatus message={state.message} ok={state.ok} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? copy.pending : copy.submit}
      </Button>
      <p className="text-xs text-muted-foreground">
        {copy.preferEmail}{" "}
        <a className="underline underline-offset-4" href={`mailto:${betaApplicationContactEmail}`}>{betaApplicationContactEmail}</a>
      </p>
    </form>
  );
}
