"use server";

import { headers } from "next/headers";
import {
  type ActionState,
  actionFailure,
  actionSuccess,
  fieldErrorsFromZod,
  formValues,
} from "@/lib/action-state";
import { hmac } from "@/lib/crypto";
import { env, isDatabaseConfigured } from "@/lib/env";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import {
  betaApplicationContactEmail,
  betaApplicationFields,
  betaApplicationHoneypotField,
  betaApplicationSchema,
} from "@/features/applications/schema";
import { recordBetaApplication } from "@/features/applications/store";

function clientIp(requestHeaders: Headers) {
  const forwarded =
    requestHeaders.get("x-vercel-forwarded-for") ??
    requestHeaders.get("x-forwarded-for") ??
    requestHeaders.get("x-real-ip") ??
    "";
  return forwarded.split(",")[0]?.trim() || null;
}

/** Keyed hash so the stored value cannot be reversed by enumerating IPs. */
function hashClientIp(ip: string | null) {
  const key = env.API_KEY_PEPPER || env.BETTER_AUTH_SECRET;
  if (!ip || !key) return null;
  return hmac(`beta-application-ip:${ip}`, key);
}

/**
 * Public beta application form. Anonymous by design: no session exists yet.
 * Abuse controls are the honeypot, a per-IP-hash limit and a global cap.
 * The submitted email is personal data and is never logged.
 */
export async function submitBetaApplicationAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: {
      invalid: "Certains champs sont à corriger.",
      received: "Merci, votre candidature est bien reçue. Nous revenons vers vous par email sous quelques jours ouvrés.",
      limited: `Trop de candidatures ont été envoyées depuis cette connexion. Réessayez dans une heure ou écrivez-nous à ${betaApplicationContactEmail}.`,
      unavailable: `Le formulaire est momentanément indisponible. Écrivez-nous à ${betaApplicationContactEmail}.`,
    },
    en: {
      invalid: "Some fields need to be corrected.",
      received: "Thank you, your application has been received. We will reply by email within a few business days.",
      limited: `Too many applications were sent from this connection. Try again in an hour or write to ${betaApplicationContactEmail}.`,
      unavailable: `The form is temporarily unavailable. Please write to ${betaApplicationContactEmail}.`,
    },
  });
  const values = formValues(formData, betaApplicationFields);
  // A filled honeypot gets the normal confirmation so bots learn nothing.
  const honeypot = formData.get(betaApplicationHoneypotField);
  if (typeof honeypot === "string" && honeypot.trim() !== "") return actionSuccess(copy.received);

  const parsed = betaApplicationSchema(locale).safeParse({ ...values, consent: formData.get("consent") ?? undefined });
  if (!parsed.success) {
    return actionFailure(copy.invalid, { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  }
  if (!isDatabaseConfigured()) return actionFailure(copy.unavailable, { values });

  try {
    const result = await recordBetaApplication(parsed.data, {
      ipHash: hashClientIp(clientIp(await headers())),
      locale,
    });
    if (result.status === "rate_limited") return actionFailure(copy.limited, { values });
    return actionSuccess(copy.received);
  } catch {
    // Database errors can echo query parameters (the email): report nothing.
    return actionFailure(copy.unavailable, { values });
  }
}
