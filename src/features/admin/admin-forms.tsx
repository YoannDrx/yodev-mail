"use client";

import { useActionState, type ReactNode } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { FieldError, FormStatus } from "@/components/form-status";
import { InvitationLinkBox } from "@/components/auth/invitation-link-box";
import { Button } from "@/components/ui/button";
import type { AdminActionState } from "@/features/admin/actions";
import { initialActionState } from "@/lib/action-state";
import { localized, type Locale } from "@/i18n/config";

type AdminAction = (previous: AdminActionState, formData: FormData) => Promise<AdminActionState>;

const initial = initialActionState() as AdminActionState;

function confirmCopy(locale: Locale) {
  return localized(locale, {
    fr: { cancel: "Annuler", pending: "En cours…" },
    en: { cancel: "Cancel", pending: "Working…" },
  });
}

/**
 * One admin decision: a single submit (or an explicit confirmation for
 * destructive ones), disabled while running, with its result announced in place.
 */
export function AdminActionButton({
  action,
  children,
  confirm,
  disabled = false,
  locale,
  variant = "default",
}: {
  action: AdminAction;
  children: ReactNode;
  confirm?: { title: string; description: string; label: string };
  disabled?: boolean;
  locale: Locale;
  variant?: "default" | "outline" | "destructive";
}) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const copy = confirmCopy(locale);
  return (
    <div className="grid max-w-full gap-2">
      {confirm ? (
        <ConfirmAction
          action={dispatch}
          cancelLabel={copy.cancel}
          confirmLabel={confirm.label}
          description={confirm.description}
          disabled={disabled || pending}
          pendingLabel={copy.pending}
          title={confirm.title}
          trigger={children}
          triggerVariant={variant === "default" ? "outline" : variant}
        />
      ) : (
        <form action={dispatch}>
          <Button disabled={disabled || pending} size="sm" type="submit" variant={variant}>{children}</Button>
        </form>
      )}
      <FormStatus className="max-w-xs" message={state.message} ok={state.ok} />
      {state.data?.link ? <InvitationLinkBox link={state.data.link} locale={locale} /> : null}
    </div>
  );
}

type ClientCopy = {
  company: string; ownerEmail: string; website: string; monthly: string; useCase: string;
  create: string; creating: string; gate: string;
};

export function ClientProvisioningForm({
  action,
  copy,
  enabled,
  locale,
}: {
  action: AdminAction;
  copy: ClientCopy;
  enabled: boolean;
  locale: Locale;
}) {
  const [state, dispatch, pending] = useActionState(action, initial);
  const field = (name: string) => ({
    "aria-describedby": state.fieldErrors[name] ? `client-${name}-error` : undefined,
    "aria-invalid": state.fieldErrors[name] ? true : undefined,
    defaultValue: state.values[name] ?? "",
    disabled: !enabled || pending,
    id: `client-${name}`,
    name,
  });
  return (
    <div className="grid gap-4 rounded-md border bg-card p-6">
      <form action={dispatch} className="grid gap-4 lg:grid-cols-2" key={state.ok ? `created-${state.message}` : "draft"}>
        <label className="grid gap-1 text-sm">{copy.company}<input className="h-10 rounded-md border px-3" maxLength={140} minLength={2} required {...field("name")} /><FieldError errors={state.fieldErrors.name} id="client-name-error" /></label>
        <label className="grid gap-1 text-sm">Slug<input className="h-10 rounded-md border px-3" maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="acme" required {...field("slug")} /><FieldError errors={state.fieldErrors.slug} id="client-slug-error" /></label>
        <label className="grid gap-1 text-sm">{copy.ownerEmail}<input className="h-10 rounded-md border px-3" maxLength={320} required type="email" {...field("ownerEmail")} /><FieldError errors={state.fieldErrors.ownerEmail} id="client-ownerEmail-error" /></label>
        <label className="grid gap-1 text-sm">{copy.website}<input className="h-10 rounded-md border px-3" maxLength={2048} required type="url" {...field("websiteUrl")} /><FieldError errors={state.fieldErrors.websiteUrl} id="client-websiteUrl-error" /></label>
        <label className="grid gap-1 text-sm">{copy.monthly}<input className="h-10 rounded-md border px-3" max={10_000_000} min={1} required type="number" {...field("expectedMonthlyVolume")} /><FieldError errors={state.fieldErrors.expectedMonthlyVolume} id="client-expectedMonthlyVolume-error" /></label>
        <label className="grid gap-1 text-sm lg:col-span-2">{copy.useCase}<textarea className="min-h-28 rounded-md border p-3" maxLength={4_000} minLength={20} required {...field("useCase")} /><FieldError errors={state.fieldErrors.useCase} id="client-useCase-error" /></label>
        <div className="lg:col-span-2"><Button disabled={!enabled || pending} type="submit">{pending ? copy.creating : copy.create}</Button></div>
        {!enabled && <p className="text-sm text-[var(--y-warning)] lg:col-span-2">{copy.gate}</p>}
      </form>
      <FormStatus message={state.message} ok={state.ok} />
      {state.data?.link ? <InvitationLinkBox link={state.data.link} locale={locale} /> : null}
    </div>
  );
}

export function AdminInviteMemberForm({
  action,
  label,
  inputLabel,
  locale,
}: {
  action: AdminAction;
  label: string;
  inputLabel: string;
  locale: Locale;
}) {
  const [state, dispatch, pending] = useActionState(action, initial);
  return (
    <div className="mt-4 grid max-w-xl gap-2">
      <form action={dispatch} className="flex gap-2">
        <input
          aria-invalid={state.fieldErrors.email ? true : undefined}
          aria-label={inputLabel}
          className="h-9 flex-1 rounded-md border px-3 text-sm"
          defaultValue={state.values.email ?? ""}
          disabled={pending}
          key={state.ok ? `sent-${state.message}` : "draft"}
          name="email"
          placeholder="membre@example.com"
          required
          type="email"
        />
        <Button disabled={pending} size="sm" type="submit" variant="outline">{label}</Button>
      </form>
      <FormStatus message={state.message} ok={state.ok} />
      {state.data?.link ? <InvitationLinkBox link={state.data.link} locale={locale} /> : null}
    </div>
  );
}
