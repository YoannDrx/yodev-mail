"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { type ActionState, actionFailure, actionSuccess } from "@/lib/action-state";
import { requireAdmin } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { markBetaApplicationReviewed } from "@/features/applications/store";

/** Admin-only: mark one application reviewed (form field `applicationId`). */
export async function markBetaApplicationReviewedAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { userId } = await requireAdmin();
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { invalid: "Candidature introuvable.", reviewed: "Candidature marquée comme traitée.", already: "Cette candidature était déjà traitée." },
    en: { invalid: "Application not found.", reviewed: "Application marked as reviewed.", already: "This application was already reviewed." },
  });
  const parsed = z.uuid().safeParse(formData.get("applicationId"));
  if (!parsed.success) return actionFailure(copy.invalid);
  const result = await markBetaApplicationReviewed(parsed.data, userId);
  if (result === "not_found") return actionFailure(copy.invalid);
  revalidatePath("/admin");
  return actionSuccess(result === "reviewed" ? copy.reviewed : copy.already);
}
