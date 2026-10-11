"use client";

import { useActionState, useState } from "react";
import { Plus, Send } from "lucide-react";
import { ConfirmAction } from "@/components/confirm-action";
import { CopyButton } from "@/components/copy-button";
import { FieldError, FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createWebhookFormAction,
  deleteWebhookAction,
  rotateWebhookSecretAction,
  sendWebhookTestAction,
  toggleWebhookAction,
} from "@/features/webhooks/actions";
import type { Locale } from "@/i18n/config";
import { localized } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

const events = ["email.queued", "email.sent", "email.delivered", "email.soft_bounced", "email.hard_bounced", "email.complained", "email.failed", "email.suppressed"];

function OneTimeSecret({ secret, locale }: { secret: string; locale: Locale }) {
  const copy = localized(locale, {
    fr: { once: "Secret de signature, affiché une seule fois", help: "Enregistrez-le dans votre application pour vérifier l’en-tête x-yodev-mail-signature. Il ne sera plus jamais affiché.", copy: "Copier le secret", copied: "Secret copié" },
    en: { once: "Signing secret, shown only once", help: "Store it in your application to verify the x-yodev-mail-signature header. It will never be shown again.", copy: "Copy secret", copied: "Secret copied" },
  });
  return (
    <div className="mt-4 rounded-md y-status-warning p-4 text-sm text-[var(--y-warning)]">
      <strong>{copy.once}</strong>
      <code className="mt-2 block break-all text-xs">{secret}</code>
      <p className="mt-2 text-xs">{copy.help}</p>
      <div className="mt-3"><CopyButton copiedLabel={copy.copied} label={copy.copy} value={secret} /></div>
    </div>
  );
}

export function WebhookForm({ locale }: { locale: Locale }) {
  const [state, action, pending] = useActionState(createWebhookFormAction, initialActionState<{ secret: string }>());
  const copy = localized(locale, {
    fr: { url: "URL de l’endpoint", urlHelp: "HTTPS, sans port ni identifiants, résolue vers des adresses publiques.", events: "Événements envoyés", add: "Ajouter l’endpoint", adding: "Ajout…" },
    en: { url: "Endpoint URL", urlHelp: "HTTPS, without port or credentials, resolving to public addresses.", events: "Events sent", add: "Add endpoint", adding: "Adding…" },
  });
  const selected = state.values.eventTypes === undefined ? events : state.values.eventTypes.split(",");
  const urlErrors = state.fieldErrors.url;
  const eventErrors = state.fieldErrors.eventTypes;
  return (
    <div className="rounded-md border bg-card p-5">
      <form action={action} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="webhook-url">{copy.url}</Label>
          <Input
            aria-describedby={urlErrors?.length ? "webhook-url-help webhook-url-error" : "webhook-url-help"}
            aria-invalid={urlErrors?.length ? true : undefined}
            defaultValue={state.values.url ?? ""}
            id="webhook-url"
            name="url"
            placeholder="https://client.com/webhooks/yodev-mail"
            required
            type="url"
          />
          <p className="text-xs text-muted-foreground" id="webhook-url-help">{copy.urlHelp}</p>
          <FieldError errors={urlErrors} id="webhook-url-error" />
        </div>
        <fieldset aria-describedby={eventErrors?.length ? "webhook-events-error" : undefined} className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{copy.events}</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {events.map((event) => (
              <label className="flex items-center gap-1.5" key={event}>
                <input defaultChecked={selected.includes(event)} name="eventTypes" type="checkbox" value={event} />
                <span className="font-mono text-xs">{event}</span>
              </label>
            ))}
          </div>
          <FieldError errors={eventErrors} id="webhook-events-error" />
        </fieldset>
        <Button className="w-fit" disabled={pending} type="submit"><Plus />{pending ? copy.adding : copy.add}</Button>
        <FormStatus message={state.message} ok={state.ok} />
      </form>
      {state.ok && state.data?.secret && <OneTimeSecret locale={locale} secret={state.data.secret} />}
    </div>
  );
}

export function WebhookEndpointActions({
  endpointId,
  enabled,
  deliveryEnabled,
  locale,
}: {
  endpointId: string;
  enabled: boolean;
  deliveryEnabled: boolean;
  locale: Locale;
}) {
  const [toggleState, toggle] = useActionState(toggleWebhookAction, initialActionState());
  const [deleteState, remove] = useActionState(deleteWebhookAction, initialActionState());
  const [rotateState, rotate] = useActionState(rotateWebhookSecretAction, initialActionState<{ secret: string }>());
  const [testState, test, testing] = useActionState(sendWebhookTestAction, initialActionState<{ statusCode: number }>());
  const copy = localized(locale, {
    fr: {
      enable: "Activer", disable: "Désactiver", disableTitle: "Désactiver cet endpoint ?",
      disableDescription: "Plus aucun événement ne lui sera envoyé et les livraisons en attente seront abandonnées définitivement. Vous pourrez le réactiver pour les événements suivants.",
      rotate: "Renouveler le secret", rotateTitle: "Renouveler le secret de signature ?",
      rotateDescription: "Un nouveau secret est généré et affiché une seule fois. L’ancien cesse immédiatement de signer les envois : mettez votre application à jour sans attendre.",
      remove: "Supprimer", removeTitle: "Supprimer cet endpoint ?",
      removeDescription: "L’endpoint, son secret et ses livraisons en attente sont supprimés définitivement. Cette action est irréversible.",
      test: "Envoyer un événement de test", testing: "Envoi…", testOff: "Événement de test indisponible tant que la livraison est désactivée.",
      cancel: "Annuler", pending: "En cours…",
    },
    en: {
      enable: "Enable", disable: "Disable", disableTitle: "Disable this endpoint?",
      disableDescription: "No more events will be sent to it and pending deliveries will be abandoned permanently. You can enable it again for later events.",
      rotate: "Rotate secret", rotateTitle: "Rotate the signing secret?",
      rotateDescription: "A new secret is generated and shown only once. The previous one immediately stops signing deliveries: update your application right away.",
      remove: "Delete", removeTitle: "Delete this endpoint?",
      removeDescription: "The endpoint, its secret and its pending deliveries are permanently deleted. This cannot be undone.",
      test: "Send a test event", testing: "Sending…", testOff: "Test events are unavailable while delivery is turned off.",
      cancel: "Cancel", pending: "Working…",
    },
  });
  const fields = { endpointId };
  // One live region per endpoint announces the outcome of the last action.
  const [last, setLast] = useState<"toggle" | "delete" | "rotate" | "test">("toggle");
  // Bumped with each submission and committed with the action result: the
  // confirmation dialogs remount closed once the outcome is known.
  const [round, setRound] = useState(0);
  const track = (name: typeof last, dispatch: (formData: FormData) => void) => (formData: FormData) => {
    setLast(name);
    setRound((value) => value + 1);
    dispatch(formData);
  };
  const status = { toggle: toggleState, delete: deleteState, rotate: rotateState, test: testState }[last];
  return (
    <div className="grid gap-3 sm:justify-items-end">
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <form action={track("test", test)}>
          <input name="endpointId" type="hidden" value={endpointId} />
          <Button aria-describedby={deliveryEnabled ? undefined : `webhook-test-off-${endpointId}`} disabled={!deliveryEnabled || testing} size="sm" type="submit" variant="outline">
            <Send />{testing ? copy.testing : copy.test}
          </Button>
        </form>
        {enabled ? (
          <ConfirmAction
            key={`disable-${round}`}
            action={track("toggle", toggle)} cancelLabel={copy.cancel} confirmLabel={copy.disable} description={copy.disableDescription}
            fields={fields} pendingLabel={copy.pending} title={copy.disableTitle} trigger={copy.disable}
          />
        ) : (
          <form action={track("toggle", toggle)}>
            <input name="endpointId" type="hidden" value={endpointId} />
            <Button size="sm" type="submit" variant="outline">{copy.enable}</Button>
          </form>
        )}
        <ConfirmAction
          key={`rotate-${round}`}
          action={track("rotate", rotate)} cancelLabel={copy.cancel} confirmLabel={copy.rotate} description={copy.rotateDescription}
          fields={fields} pendingLabel={copy.pending} title={copy.rotateTitle} trigger={copy.rotate}
        />
        <ConfirmAction
          key={`delete-${round}`}
          action={track("delete", remove)} cancelLabel={copy.cancel} confirmLabel={copy.remove} description={copy.removeDescription}
          fields={fields} pendingLabel={copy.pending} title={copy.removeTitle} trigger={copy.remove} triggerVariant="destructive"
        />
      </div>
      {!deliveryEnabled && <p className="text-xs text-muted-foreground" id={`webhook-test-off-${endpointId}`}>{copy.testOff}</p>}
      <FormStatus message={status.message} ok={status.ok} />
      {rotateState.ok && rotateState.data?.secret && <OneTimeSecret locale={locale} secret={rotateState.data.secret} />}
    </div>
  );
}
