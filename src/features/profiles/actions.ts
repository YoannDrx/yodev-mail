"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, transactionalProfiles } from "@/db/schema";
import { profileFieldMessages, profileFields, profileSchema } from "@/features/profiles/schema";
import { localized } from "@/i18n/config";
import { actionFailure, actionSuccess, formValues, type ActionState } from "@/lib/action-state";
import { ConsoleActionError, invalidForm, localizedFieldErrors, runConsoleAction } from "@/lib/console-action";
import { currentWorkspace } from "@/lib/current-workspace";

const duplicateKey = new ConsoleActionError({
  fr: "Un cas d’usage utilise déjà cette clé dans ce workspace.",
  en: "A use case already uses this key in this workspace.",
}, "key");

export async function createTransactionalProfileAction(_: ActionState, formData: FormData): Promise<ActionState> {
  return runConsoleAction(formData, profileFields, async (locale) => {
    const parsed = profileSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionFailure(localized(locale, invalidForm), {
        fieldErrors: localizedFieldErrors(locale, parsed.error, profileFieldMessages),
        values: formValues(formData, profileFields),
      });
    }
    const data = parsed.data;
    const { workspace, userId } = await currentWorkspace({ admin: true });
    const db = requireDb();
    await db.transaction(async (tx) => {
      const [profile] = await tx.insert(transactionalProfiles).values({
        workspaceId: workspace.id,
        ...data,
        status: "pending_review",
        submittedAt: new Date(),
      }).returning();
      await tx.insert(auditEvents).values({
        workspaceId: workspace.id,
        actorUserId: userId,
        action: "transactional_profile.submitted",
        entityType: "transactional_profile",
        entityId: profile.id,
        metadata: { key: data.key, expectedMonthlyVolume: data.expectedMonthlyVolume },
      });
    });
    revalidatePath("/dashboard/profils");
    return actionSuccess(localized(locale, {
      fr: `Le cas d’usage « ${data.name} » est soumis à validation.`,
      en: `The “${data.name}” use case was submitted for review.`,
    }));
  }, { uniqueViolation: duplicateKey });
}

export async function disableTransactionalProfileAction(profileId: string) {
  const id = z.string().uuid().parse(profileId);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  await requireDb().transaction(async (tx) => {
    const disabled = await tx.update(transactionalProfiles).set({ status: "disabled", updatedAt: new Date() }).where(and(
      eq(transactionalProfiles.id, id),
      eq(transactionalProfiles.workspaceId, workspace.id),
    )).returning({ id: transactionalProfiles.id });
    if (!disabled.length) throw new Error("Transactional profile not found");
    await tx.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "transactional_profile.disabled", entityType: "transactional_profile", entityId: id });
  });
  revalidatePath("/dashboard/profils");
}
