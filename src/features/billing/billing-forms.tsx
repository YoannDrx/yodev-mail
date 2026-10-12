"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { checkoutAction, portalAction } from "@/features/billing/actions";
import { localized, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function CheckoutForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(checkoutAction, initialActionState());
  const copy = localized(locale, {
    fr: { submit: "Finaliser l’abonnement", pending: "Ouverture de Stripe…" },
    en: { submit: "Complete subscription", pending: "Opening Stripe…" },
  });
  return (
    <form action={action} className="mt-6 grid gap-3">
      <Button className="w-fit" disabled={pending} type="submit">{pending ? copy.pending : copy.submit}</Button>
      <FormStatus message={state.message} ok={state.ok} />
    </form>
  );
}

export function PortalForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(portalAction, initialActionState());
  const copy = localized(locale, {
    fr: { submit: "Ouvrir le portail Stripe", pending: "Ouverture du portail…" },
    en: { submit: "Open Stripe portal", pending: "Opening the portal…" },
  });
  return (
    <form action={action} className="mt-6 grid gap-3">
      <Button className="w-fit" disabled={pending} type="submit" variant="outline">{pending ? copy.pending : copy.submit}</Button>
      <FormStatus message={state.message} ok={state.ok} />
    </form>
  );
}
