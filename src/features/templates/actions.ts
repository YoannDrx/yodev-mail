"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { templateLimits } from "@/features/templates/document";
import { createTemplate, createTemplateVersion, TemplateNotEditableError } from "@/features/templates/versioning";
import { localized, type Locale } from "@/i18n/config";
import { actionFailure, actionSuccess, formValues, type ActionState } from "@/lib/action-state";
import { ConsoleActionError, invalidForm, localizedFieldErrors, runConsoleAction } from "@/lib/console-action";
import { currentWorkspace } from "@/lib/current-workspace";

const text = (field: keyof typeof templateLimits) =>
  z.string().trim().min(templateLimits[field].min).max(templateLimits[field].max);

const contentSchema = z.object({
  body: text("body"),
  name: text("name"),
  subject: text("subject"),
});

const createSchema = contentSchema.extend({ transactionalProfileId: z.string().uuid() });

const contentFields = ["name", "subject", "body"] as const;
const createFields = [...contentFields, "transactionalProfileId"] as const;

const fieldMessages: Record<string, Record<Locale, string>> = {
  name: { fr: "Entre 2 et 160 caractères.", en: "Between 2 and 160 characters." },
  subject: { fr: "Entre 1 et 255 caractères.", en: "Between 1 and 255 characters." },
  body: { fr: "Le contenu est obligatoire (100 000 caractères maximum).", en: "Content is required (100,000 characters maximum)." },
  transactionalProfileId: { fr: "Choisissez le cas d’usage de ce template.", en: "Choose this template’s use case." },
};

function notEditable(error: unknown) {
  if (!(error instanceof TemplateNotEditableError)) return error;
  if (error.reason === "profile_not_found") {
    return new ConsoleActionError({ fr: "Ce cas d’usage n’existe pas dans le workspace.", en: "This use case does not exist in the workspace." }, "transactionalProfileId");
  }
  if (error.reason === "disabled") {
    return new ConsoleActionError({ fr: "Ce template a été désactivé par Yodev et ne peut plus être modifié.", en: "Yodev disabled this template; it can no longer be edited." });
  }
  return new ConsoleActionError({ fr: "Template introuvable.", en: "Template not found." });
}

export async function createTemplateAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runConsoleAction(formData, createFields, async (locale) => {
    const parsed = createSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionFailure(localized(locale, invalidForm), {
        fieldErrors: localizedFieldErrors(locale, parsed.error, fieldMessages),
        values: formValues(formData, createFields),
      });
    }
    // Template content is reviewed like domains and use cases: owners and admins only.
    const { workspace, userId } = await currentWorkspace({ admin: true });
    try {
      await createTemplate(requireDb(), { ...parsed.data, workspaceId: workspace.id, userId });
    } catch (error) {
      throw notEditable(error);
    }
    revalidatePath("/dashboard/templates");
    return actionSuccess(localized(locale, {
      fr: `Le template « ${parsed.data.name} » est soumis à validation. Son identifiant est affiché ci-dessous.`,
      en: `The “${parsed.data.name}” template was submitted for review. Its ID is shown below.`,
    }));
  });
}

export async function updateTemplateAction(templateId: string, _: ActionState, formData: FormData): Promise<ActionState> {
  return runConsoleAction(formData, contentFields, async (locale) => {
    const id = z.string().uuid().safeParse(templateId);
    if (!id.success) throw notEditable(new TemplateNotEditableError("not_found"));
    const parsed = contentSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionFailure(localized(locale, invalidForm), {
        fieldErrors: localizedFieldErrors(locale, parsed.error, fieldMessages),
        values: formValues(formData, contentFields),
      });
    }
    const { workspace, userId } = await currentWorkspace({ admin: true });
    let version: number;
    try {
      ({ version } = await createTemplateVersion(requireDb(), { ...parsed.data, templateId: id.data, workspaceId: workspace.id, userId }));
    } catch (error) {
      throw notEditable(error);
    }
    revalidatePath("/dashboard/templates");
    revalidatePath(`/dashboard/templates/${id.data}`);
    return actionSuccess(localized(locale, {
      fr: `Version ${version} enregistrée et soumise à validation.`,
      en: `Version ${version} saved and submitted for review.`,
    }));
  }, {
    uniqueViolation: new ConsoleActionError({
      fr: "Le template vient d’être modifié par ailleurs. Rechargez la page avant de réessayer.",
      en: "The template was just changed elsewhere. Reload the page before trying again.",
    }),
  });
}
