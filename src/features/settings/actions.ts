"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, workspaceSettings } from "@/db/schema";
import {
  type ActionState,
  actionFailure,
  actionSuccess,
  fieldErrorsFromZod,
  formValues,
} from "@/lib/action-state";
import { currentWorkspace } from "@/lib/current-workspace";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

const settingsFields = ["companyName", "companyAddress", "defaultFromName", "defaultReplyTo"] as const;

/** Workspace owners and admins update the sender identity used by default. */
export async function updateSettingsAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { invalid: "Certains champs sont à corriger.", saved: "Paramètres enregistrés.", tooLong: "Ce champ est trop long.", email: "Indiquez une adresse email valide ou laissez le champ vide." },
    en: { invalid: "Some fields need to be corrected.", saved: "Settings saved.", tooLong: "This field is too long.", email: "Enter a valid email address or leave the field empty." },
  });
  const schema = z.object({
    companyName: z.string().trim().max(180, copy.tooLong),
    companyAddress: z.string().trim().max(500, copy.tooLong),
    defaultFromName: z.string().trim().max(140, copy.tooLong),
    defaultReplyTo: z.union([z.literal(""), z.string().trim().max(320, copy.email).pipe(z.email(copy.email))]),
  });
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const values = formValues(formData, settingsFields);
  const parsed = schema.safeParse({
    companyName: values.companyName ?? "",
    companyAddress: values.companyAddress ?? "",
    defaultFromName: values.defaultFromName ?? "",
    defaultReplyTo: (values.defaultReplyTo ?? "").trim(),
  });
  if (!parsed.success) return actionFailure(copy.invalid, { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  // Empty fields clear the stored value.
  const data = {
    companyName: parsed.data.companyName || null,
    companyAddress: parsed.data.companyAddress || null,
    defaultFromName: parsed.data.defaultFromName || null,
    defaultReplyTo: parsed.data.defaultReplyTo || null,
  };
  await requireDb().transaction(async (tx) => {
    await tx
      .insert(workspaceSettings)
      .values({ workspaceId: workspace.id, ...data })
      .onConflictDoUpdate({ target: workspaceSettings.workspaceId, set: { ...data, updatedAt: new Date() } });
    await tx.insert(auditEvents).values({
      action: "workspace.settings_updated",
      actorUserId: userId,
      entityId: workspace.id,
      entityType: "workspace",
      workspaceId: workspace.id,
    });
  });
  revalidatePath("/dashboard/parametres");
  return actionSuccess(copy.saved);
}
