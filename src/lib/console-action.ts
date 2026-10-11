import "server-only";

import { unstable_rethrow } from "next/navigation";
import type { ZodError } from "zod";
import { localized, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import {
  actionFailure,
  formValues,
  type ActionState,
  type FieldErrors,
} from "@/lib/action-state";
import { WorkspaceAccessError } from "@/lib/current-workspace";

type Copy = Record<Locale, string>;

/** An expected refusal whose localized message can be shown as is. */
export class ConsoleActionError extends Error {
  constructor(readonly copy: Copy, readonly field?: string) {
    super(copy.en);
    this.name = "ConsoleActionError";
  }
}

const roleRequired: Copy = {
  fr: "Seuls les propriétaires et administrateurs du workspace peuvent effectuer cette action.",
  en: "Only workspace owners and administrators can perform this action.",
};

const noWorkspace: Copy = {
  fr: "Aucun workspace accessible pour cette session. Rechargez la page ou reconnectez-vous.",
  en: "No workspace is available for this session. Reload the page or sign in again.",
};

const unexpected: Copy = {
  fr: "L’action n’a pas pu aboutir. Votre saisie est conservée ; réessayez dans un instant.",
  en: "The action could not be completed. Your input is kept; try again in a moment.",
};

export const invalidForm: Copy = {
  fr: "Certains champs sont invalides. Corrigez-les puis renvoyez le formulaire.",
  en: "Some fields are invalid. Fix them and submit the form again.",
};

/**
 * Maps zod issues to one localized message per field. Messages describe the
 * same constraints as the HTML attributes rendered on the field.
 */
export function localizedFieldErrors(
  locale: Locale,
  error: ZodError,
  messages: Record<string, Copy>,
): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join(".") || "_form";
    if (fieldErrors[field]) continue;
    const copy = messages[field];
    fieldErrors[field] = [copy ? localized(locale, copy) : localized(locale, { fr: "Valeur invalide.", en: "Invalid value." })];
  }
  return fieldErrors;
}

function databaseCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Runs a console form action and turns every expected failure into an
 * ActionState: the form stays on the page with its values and an announced
 * message. Next.js control flow (redirect, notFound) is rethrown untouched.
 */
export async function runConsoleAction<TData = undefined>(
  formData: FormData | null,
  fields: readonly string[],
  run: (locale: Locale) => Promise<ActionState<TData>>,
  options: { uniqueViolation?: ConsoleActionError; values?: Record<string, string> } = {},
): Promise<ActionState<TData>> {
  const locale = await getLocale();
  const values = { ...(formData ? formValues(formData, fields) : {}), ...options.values };
  try {
    return await run(locale);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ConsoleActionError) {
      const message = localized(locale, error.copy);
      return actionFailure(message, {
        values,
        fieldErrors: error.field ? { [error.field]: [message] } : {},
      });
    }
    if (error instanceof WorkspaceAccessError) return actionFailure(localized(locale, noWorkspace), { values });
    if (error instanceof Error && error.message === "Workspace administrator role required.") {
      return actionFailure(localized(locale, roleRequired), { values });
    }
    const code = databaseCode(error);
    if (code === "23505" && options.uniqueViolation) {
      const message = localized(locale, options.uniqueViolation.copy);
      return actionFailure(message, {
        values,
        fieldErrors: options.uniqueViolation.field ? { [options.uniqueViolation.field]: [message] } : {},
      });
    }
    // Opaque identifiers only: messages can carry submitted values.
    console.error("console_action_failed", { name: error instanceof Error ? error.name : typeof error, code });
    return actionFailure(localized(locale, unexpected), { values });
  }
}
