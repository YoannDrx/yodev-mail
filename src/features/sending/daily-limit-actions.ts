"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionState,
  actionFailure,
  actionSuccess,
  fieldErrorsFromZod,
  formValues,
} from "@/lib/action-state";
import { requireAdmin } from "@/lib/page-auth";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import {
  DailyLimitWorkspaceNotFoundError,
  MAX_OPERATOR_DAILY_LIMIT,
  setWorkspaceDailyLimit,
} from "@/features/sending/daily-limit";

const formSchema = z.object({
  workspaceId: z.uuid(),
  // Empty or "auto" returns the workspace to its automatic warmup limit.
  dailyLimit: z.union([
    z.literal("").transform(() => null),
    z.literal("auto").transform(() => null),
    z.coerce.number().int().min(1).max(MAX_OPERATOR_DAILY_LIMIT),
  ]),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Admin-only: pin or release a workspace's daily limit (form fields
 * `workspaceId`, `dailyLimit`, `reason`). For use with useActionState.
 */
export async function setWorkspaceDailyLimitAction(
  _previous: ActionState<{ dailyLimit: number; overridden: boolean }>,
  formData: FormData,
): Promise<ActionState<{ dailyLimit: number; overridden: boolean }>> {
  const { userId } = await requireAdmin();
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { invalid: "Vérifiez la limite (1 à 50 000, ou vide pour la montée en charge automatique) et le motif.", missing: "Workspace introuvable.", saved: "Limite quotidienne enregistrée.", released: "Limite rendue à la montée en charge automatique." },
    en: { invalid: "Check the limit (1 to 50,000, or empty for automatic warmup) and the reason.", missing: "Workspace not found.", saved: "Daily limit saved.", released: "Limit returned to automatic warmup." },
  });
  const values = formValues(formData, ["workspaceId", "dailyLimit", "reason"]);
  const parsed = formSchema.safeParse(values);
  if (!parsed.success) return actionFailure(copy.invalid, { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  try {
    const result = await setWorkspaceDailyLimit({ ...parsed.data, actorUserId: userId });
    revalidatePath("/admin");
    return actionSuccess(result.overridden ? copy.saved : copy.released, result);
  } catch (error) {
    if (error instanceof DailyLimitWorkspaceNotFoundError) return actionFailure(copy.missing, { values });
    throw error;
  }
}
