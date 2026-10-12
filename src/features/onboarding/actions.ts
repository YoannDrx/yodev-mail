"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { localized, localizedPath } from "@/i18n/config";
import { requireDb } from "@/db";
import {
  adminReviews,
  auditEvents,
  workspaceSettings,
  workspaces,
} from "@/db/schema";
import { actionFailure, formValues, type ActionState } from "@/lib/action-state";
import { ConsoleActionError, invalidForm, localizedFieldErrors, runConsoleAction } from "@/lib/console-action";
import { currentWorkspace } from "@/lib/current-workspace";
import { onboardingFieldMessages, onboardingFields, onboardingSchema } from "@/features/onboarding/schema";

export async function completeOnboardingAction(_: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string | null = null;
  const state = await runConsoleAction(formData, onboardingFields, async (locale) => {
    const parsed = onboardingSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      return actionFailure(localized(locale, invalidForm), {
        fieldErrors: localizedFieldErrors(locale, parsed.error, onboardingFieldMessages),
        values: formValues(formData, onboardingFields),
      });
    }
    const data = parsed.data;
    const { workspace, userId } = await currentWorkspace({ admin: true });
    if (!["sandbox", "pending_review"].includes(workspace.status)) {
      throw new ConsoleActionError({
        fr: "Ce workspace ne peut plus soumettre un dossier d’onboarding.",
        en: "This workspace can no longer submit an onboarding application.",
      });
    }
    const db = requireDb();
    await db.transaction(async (tx) => {
      await tx
        .update(workspaces)
        .set({
          expectedMonthlyVolume: data.expectedMonthlyVolume,
          status: "pending_review",
          updatedAt: new Date(),
          useCase: JSON.stringify({
            applicationName: data.applicationName,
            domains: data.domainNames.split(/[\n,]/).map((value) => value.trim().toLowerCase()).filter(Boolean),
            categories: data.categories,
            triggerDescription: data.triggerDescription,
            recipientRelationship: data.recipientRelationship,
            dailyPeakVolume: data.dailyPeakVolume,
            averageDailyVolume: data.averageDailyVolume,
            exampleContent: data.exampleContent,
            errorPolicy: data.errorPolicy,
            attestations: {
              noPurchasedLists: true,
              noColdEmail: true,
              noNewsletter: true,
              noMarketing: true,
              noCircumvention: true,
              suspensionAccepted: true,
            },
          }),
          websiteUrl: data.websiteUrl,
        })
        .where(eq(workspaces.id, workspace.id));
      await tx
        .update(workspaceSettings)
        .set({
          abusePolicyAcceptedAt: new Date(),
          companyAddress: data.companyAddress,
          companyName: data.companyName,
          updatedAt: new Date(),
        })
        .where(eq(workspaceSettings.workspaceId, workspace.id));
      await tx
        .insert(adminReviews)
        .values({ workspaceId: workspace.id })
        .onConflictDoNothing();
      await tx.insert(auditEvents).values({
        action: "workspace.onboarding_completed",
        actorUserId: userId,
        entityId: workspace.id,
        entityType: "workspace",
        metadata: { expectedMonthlyVolume: data.expectedMonthlyVolume },
        workspaceId: workspace.id,
      });
    });
    destination = localizedPath(locale, "/dashboard");
    return { ok: true, message: "", fieldErrors: {}, values: {} };
  });
  // Navigate outside the guarded block: redirect() must never be turned into a form error.
  if (destination) redirect(destination);
  return state;
}
