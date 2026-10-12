"use client";

import { useActionState } from "react";
import { FieldError, FormStatus } from "@/components/form-status";
import { describedBy } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markBetaApplicationReviewedAction } from "@/features/applications/admin-actions";
import { setWorkspaceDailyLimitAction } from "@/features/sending/daily-limit-actions";
import { initialActionState } from "@/lib/action-state";
import { localized, type Locale } from "@/i18n/config";

/** Pins a workspace's daily limit, or hands it back to automatic warmup when left empty. */
export function DailyLimitForm({ workspaceId, current, automatic, overridden, locale }: {
  workspaceId: string;
  current: number;
  automatic: number;
  overridden: boolean;
  locale: Locale;
}) {
  const [state, action, pending] = useActionState(setWorkspaceDailyLimitAction, initialActionState<{ dailyLimit: number; overridden: boolean }>());
  const copy = localized(locale, {
    fr: { limit: "Limite quotidienne", hint: `Vide = montée en charge automatique (${automatic}/jour au stade actuel).`, reason: "Motif (audité)", save: "Enregistrer", saving: "Enregistrement…", pinned: `Limite fixée manuellement à ${current}/jour.`, auto: `Limite automatique : ${current}/jour.` },
    en: { limit: "Daily limit", hint: `Empty = automatic warmup (${automatic}/day at the current stage).`, reason: "Reason (audited)", save: "Save", saving: "Saving…", pinned: `Limit pinned manually at ${current}/day.`, auto: `Automatic limit: ${current}/day.` },
  });
  const limitId = `daily-limit-${workspaceId}`;
  const reasonId = `daily-limit-reason-${workspaceId}`;
  const limitErrors = state.fieldErrors.dailyLimit;
  const reasonErrors = state.fieldErrors.reason;
  return <form action={action} aria-busy={pending} className="mt-4 grid gap-3 rounded-md border p-4 md:grid-cols-[160px_1fr_auto] md:items-end">
    <input name="workspaceId" type="hidden" value={workspaceId} />
    <p className="text-sm text-muted-foreground md:col-span-3">{overridden ? copy.pinned : copy.auto}</p>
    <div className="grid gap-2">
      <Label htmlFor={limitId}>{copy.limit}</Label>
      <Input aria-describedby={describedBy(limitId, true, Boolean(limitErrors?.length))} aria-invalid={limitErrors?.length ? true : undefined} defaultValue={state.values.dailyLimit ?? (overridden ? String(current) : "")} id={limitId} inputMode="numeric" name="dailyLimit" pattern="[0-9]*|auto" />
      <p className="text-xs text-muted-foreground" id={`${limitId}-hint`}>{copy.hint}</p>
      <FieldError errors={limitErrors} id={`${limitId}-error`} />
    </div>
    <div className="grid gap-2">
      <Label htmlFor={reasonId}>{copy.reason}</Label>
      <Input aria-describedby={describedBy(reasonId, false, Boolean(reasonErrors?.length))} aria-invalid={reasonErrors?.length ? true : undefined} defaultValue={state.values.reason} id={reasonId} maxLength={500} minLength={3} name="reason" required />
      <FieldError errors={reasonErrors} id={`${reasonId}-error`} />
    </div>
    <Button disabled={pending} size="sm" type="submit" variant="outline">{pending ? copy.saving : copy.save}</Button>
    <FormStatus className="md:col-span-3" message={state.message} ok={state.ok} />
  </form>;
}

export function ReviewApplicationButton({ applicationId, locale }: { applicationId: string; locale: Locale }) {
  const [state, action, pending] = useActionState(markBetaApplicationReviewedAction, initialActionState());
  const copy = localized(locale, { fr: { mark: "Marquer comme traitée", pending: "En cours…" }, en: { mark: "Mark as reviewed", pending: "Working…" } });
  return <form action={action} className="grid gap-2">
    <input name="applicationId" type="hidden" value={applicationId} />
    <Button disabled={pending} size="sm" type="submit" variant="outline">{pending ? copy.pending : copy.mark}</Button>
    <FormStatus className="max-w-xs" message={state.message} ok={state.ok} />
  </form>;
}
