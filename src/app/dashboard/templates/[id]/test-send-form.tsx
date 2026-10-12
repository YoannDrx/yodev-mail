"use client";

import { startTransition, useActionState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { TextAreaField, TextField } from "@/components/form-field";
import { FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { sendConsoleTestAction, type ConsoleTestSendData } from "@/features/emails/console-test-send";
import { localized, localizedPath, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

export function TestSendForm({ locale, templateId, defaultFrom, defaultTo, defaultVariables, disabledReason }: {
  locale: Locale;
  templateId: string;
  defaultFrom: string;
  defaultTo: string;
  defaultVariables: string;
  disabledReason?: string;
}) {
  const [state, action, pending] = useActionState(
    sendConsoleTestAction.bind(null, templateId),
    initialActionState<ConsoleTestSendData>(),
  );
  const copy = localized(locale, {
    fr: { title: "Envoyer un test", text: "Le message passe par toutes les vérifications de l’API en mode test et est enregistré comme simulé : rien n’est livré ni facturé.", from: "Adresse d’expédition", to: "Destinataire", variables: "Variables (JSON)", submit: "Envoyer le test", pending: "Envoi…", open: "Voir le message" },
    en: { title: "Send a test", text: "The message goes through every API check in test mode and is stored as simulated: nothing is delivered or billed.", from: "Sender address", to: "Recipient", variables: "Variables (JSON)", submit: "Send test", pending: "Sending…", open: "View message" },
  });
  const disabled = pending || Boolean(disabledReason);
  return <section aria-labelledby="template-test-send-title" className="mt-6 grid gap-4 rounded-md border bg-card p-6">
    <div className="grid gap-1">
      <h2 className="font-semibold" id="template-test-send-title">{copy.title}</h2>
      <p className="text-sm text-muted-foreground">{disabledReason ?? copy.text}</p>
    </div>
    {/* Submitted without the form action prop so React does not reset the
        fields: the sender, recipient and variables stay for the next test. */}
    <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => action(formData));
    }}>
      <TextField defaultValue={defaultFrom} disabled={Boolean(disabledReason)} label={copy.from} name="from" state={state} type="email" />
      <TextField defaultValue={defaultTo} disabled={Boolean(disabledReason)} label={copy.to} name="to" state={state} type="email" />
      <TextAreaField className="md:col-span-2" defaultValue={defaultVariables} disabled={Boolean(disabledReason)} label={copy.variables} name="variables" required={false} rows={4} state={state} />
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button disabled={disabled} type="submit"><Send />{pending ? copy.pending : copy.submit}</Button>
        <FormStatus message={state.message} ok={state.ok} />
        {state.ok && state.data ? <Link className="text-sm underline underline-offset-4" href={localizedPath(locale, `/dashboard/emails/${state.data.messageId}`)}>{copy.open}</Link> : null}
      </div>
    </form>
  </section>;
}
