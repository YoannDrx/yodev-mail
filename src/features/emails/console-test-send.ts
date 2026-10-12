"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, templates, transactionalProfiles } from "@/db/schema";
import { consumeWorkspaceRateLimit } from "@/features/api/rate-limit";
import { acceptEmail } from "@/features/emails/accept";
import { localized, type Locale } from "@/i18n/config";
import { actionFailure, actionSuccess, formValues, type ActionState } from "@/lib/action-state";
import { ConsoleActionError, invalidForm, localizedFieldErrors, runConsoleAction } from "@/lib/console-action";
import { currentWorkspace } from "@/lib/current-workspace";

const fields = ["from", "to", "variables"] as const;

const schema = z.object({
  from: z.string().trim().email(),
  to: z.string().trim().email(),
  variables: z.string().trim().max(10_000).transform((value, context) => {
    if (!value) return {};
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Reported below as a field error.
    }
    context.addIssue({ code: "custom", message: "invalid_json" });
    return z.NEVER;
  }),
});

const fieldMessages: Record<string, Record<Locale, string>> = {
  from: { fr: "Adresse d’expédition invalide.", en: "Invalid sender address." },
  to: { fr: "Adresse de destination invalide.", en: "Invalid recipient address." },
  variables: { fr: "Objet JSON attendu, par exemple {\"firstName\": \"Ada\"}.", en: "A JSON object is expected, for example {\"firstName\": \"Ada\"}." },
};

// API refusals the console can explain; anything else shows its code.
const refusals: Record<string, Record<Locale, string>> = {
  domain_not_ready: { fr: "Le domaine de l’adresse d’expédition n’est pas vérifié dans ce workspace.", en: "The sender address domain is not verified in this workspace." },
  transactional_profile_not_approved: { fr: "Le cas d’usage de ce template n’est pas encore approuvé.", en: "This template’s use case is not approved yet." },
  template_not_approved: { fr: "Ce template n’est pas approuvé : il ne peut pas encore être envoyé.", en: "This template is not approved, so it cannot be sent yet." },
  template_variables_missing: { fr: "Des variables du template n’ont pas de valeur.", en: "Some template variables have no value." },
  template_variables_too_long: { fr: "Une variable dépasse la longueur autorisée.", en: "A variable exceeds the allowed length." },
  invalid_request: { fr: "La requête générée est invalide : vérifiez les adresses et les variables.", en: "The generated request is invalid: check the addresses and variables." },
};

export type ConsoleTestSendData = { messageId: string };

/**
 * Sends one template through the real acceptance pipeline in test mode: every
 * API check runs and the message is stored as `simulated`, with no delivery,
 * no quota reservation and no billing.
 */
export async function sendConsoleTestAction(
  templateId: string,
  _: ActionState<ConsoleTestSendData>,
  formData: FormData,
): Promise<ActionState<ConsoleTestSendData>> {
  return runConsoleAction<ConsoleTestSendData>(formData, fields, async (locale) => {
    const id = z.string().uuid().safeParse(templateId);
    if (!id.success) throw new ConsoleActionError({ fr: "Template introuvable.", en: "Template not found." });
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionFailure(localized(locale, invalidForm), {
        fieldErrors: localizedFieldErrors(locale, parsed.error, fieldMessages),
        values: formValues(formData, fields),
      });
    }
    const { workspace, userId } = await currentWorkspace({ admin: true });
    const db = requireDb();
    const [template] = await db
      .select({ id: templates.id, category: transactionalProfiles.key })
      .from(templates)
      .innerJoin(transactionalProfiles, and(
        eq(transactionalProfiles.id, templates.transactionalProfileId),
        eq(transactionalProfiles.workspaceId, workspace.id),
      ))
      .where(and(eq(templates.id, id.data), eq(templates.workspaceId, workspace.id)))
      .limit(1);
    if (!template) throw new ConsoleActionError({ fr: "Template introuvable.", en: "Template not found." });

    // Same per-minute budget as test API calls, so the button cannot flood the table.
    const rate = await consumeWorkspaceRateLimit(workspace.id, "test");
    if (!rate.allowed) {
      throw new ConsoleActionError({ fr: "Trop d’envois de test en une minute. Réessayez dans un instant.", en: "Too many test sends in one minute. Try again shortly." });
    }

    const result = await acceptEmail({
      workspaceId: workspace.id,
      mode: "test",
      scopes: ["emails:send"],
      idempotencyKey: `console-test:${randomUUID()}`,
      existing: undefined,
      raw: {
        from: { email: parsed.data.from },
        to: { email: parsed.data.to },
        category: template.category,
        content: { templateId: template.id, variables: parsed.data.variables },
      },
      source: "console",
    });
    if (result.status !== 202) {
      const code = String((result.body.error as { code?: unknown } | undefined)?.code ?? "unknown");
      const known = refusals[code];
      return actionFailure(known ? localized(locale, known) : localized(locale, {
        fr: `Envoi de test refusé (${code}).`,
        en: `Test send refused (${code}).`,
      }), { values: formValues(formData, fields) });
    }
    const messageId = (result.body.data as { id: string }).id;
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "email.console_test_sent",
      entityType: "message",
      entityId: messageId,
      metadata: { templateId: template.id },
    });
    revalidatePath("/dashboard/emails");
    return actionSuccess(localized(locale, {
      fr: "Envoi de test accepté : le message est enregistré comme simulé, sans livraison ni facturation.",
      en: "Test send accepted: the message is stored as simulated, with no delivery or billing.",
    }), { messageId });
  });
}
