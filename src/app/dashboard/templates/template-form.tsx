"use client";

import { useActionState, useMemo, useState } from "react";
import { Plus, Save } from "lucide-react";
import { describedBy, TextAreaField, TextField } from "@/components/form-field";
import { FieldError, FormStatus } from "@/components/form-status";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createTemplateAction, updateTemplateAction } from "@/features/templates/actions";
import { previewTemplate, templateHtmlFromText, templateLimits } from "@/features/templates/document";
import { localized, type Locale } from "@/i18n/config";
import { initialActionState } from "@/lib/action-state";

type Profile = { id: string; label: string };

/** Rendered with the API renderer in a sandboxed frame: no script, no same-origin access. */
export function TemplatePreview({ subject, body, html, locale, title }: { subject: string; body: string; html?: string; locale: Locale; title?: string }) {
  const copy = localized(locale, { fr: { preview: "Aperçu", subject: "Sujet", variables: "Variables", none: "Aucune variable." }, en: { preview: "Preview", subject: "Subject", variables: "Variables", none: "No variables." } });
  const preview = useMemo(() => previewTemplate({ subject, html: html ?? templateHtmlFromText(body), plainText: body }), [subject, body, html]);
  return <figure className="grid gap-2">
    <figcaption className="text-sm font-medium">{title ?? copy.preview}</figcaption>
    <p className="text-sm"><span className="text-muted-foreground">{copy.subject} : </span>{preview.subject}</p>
    <iframe className="h-64 w-full rounded-md border bg-white" sandbox="" srcDoc={preview.document} title={`${title ?? copy.preview} — ${preview.subject}`} />
    <p className="text-xs text-muted-foreground">{copy.variables} : {preview.variables.length ? preview.variables.map((name) => <code className="mr-2" key={name}>{name}</code>) : copy.none}</p>
  </figure>;
}

export function TemplateForm({ locale, canManage, profiles, template }: {
  locale: Locale;
  canManage: boolean;
  profiles?: Profile[];
  template?: { id: string; name: string; subject: string; body: string };
}) {
  const action = template ? updateTemplateAction.bind(null, template.id) : createTemplateAction;
  const [state, formAction, pending] = useActionState(action, initialActionState());
  const copy = localized(locale, {
    fr: { name: "Nom", subject: "Sujet", useCase: "Cas d’usage", select: "Sélectionner", body: "Contenu texte", bodyHint: "Variables entre doubles accolades, par exemple {{firstName}}. Une ligne vide sépare les paragraphes.", placeholder: "Bonjour {{firstName}},…", submit: "Soumettre le template", save: "Enregistrer une nouvelle version", pending: "Enregistrement…", review: "Chaque nouvelle version repart en validation : les envois utilisant ce template sont refusés jusqu’à la nouvelle approbation.", admin: "Seuls les propriétaires et administrateurs peuvent créer ou modifier un template.", noProfile: "Déclarez d’abord un cas d’usage." },
    en: { name: "Name", subject: "Subject", useCase: "Use case", select: "Select", body: "Plain-text content", bodyHint: "Variables go between double braces, for example {{firstName}}. A blank line separates paragraphs.", placeholder: "Hello {{firstName}},…", submit: "Submit template", save: "Save a new version", pending: "Saving…", review: "Every new version goes back to review: sends using this template are refused until it is approved again.", admin: "Only owners and administrators can create or edit a template.", noProfile: "Declare a use case first." },
  });
  const initialSubject = state.values.subject ?? template?.subject ?? "";
  const initialBody = state.values.body ?? template?.body ?? "";
  const [draft, setDraft] = useState({ subject: initialSubject, body: initialBody });
  const disabled = !canManage || (!template && !profiles?.length);
  const profileErrors = state.fieldErrors.transactionalProfileId;
  const syncDraft = (form: HTMLFormElement) => {
    const data = new FormData(form);
    setDraft({ subject: String(data.get("subject") ?? ""), body: String(data.get("body") ?? "") });
  };
  return <form action={formAction} aria-busy={pending} className="grid gap-4 rounded-md border bg-card p-6 lg:grid-cols-[1fr_1fr]" onInput={(event) => syncDraft(event.currentTarget)} onReset={(event) => {
    // The reset event fires before fields are restored; read them on the next tick.
    const form = event.currentTarget;
    window.setTimeout(() => syncDraft(form), 0);
  }}>
    <div className="grid content-start gap-4">
      {!canManage ? <p className="text-sm text-muted-foreground">{copy.admin}</p> : null}
      {template ? <p className="text-sm text-muted-foreground">{copy.review}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField defaultValue={template?.name} disabled={disabled} label={copy.name} maxLength={templateLimits.name.max} minLength={templateLimits.name.min} name="name" state={state} />
        <TextField defaultValue={template?.subject} disabled={disabled} label={copy.subject} maxLength={templateLimits.subject.max} name="subject" state={state} />
      </div>
      {!template ? <div className="grid gap-2">
        <Label htmlFor="transactionalProfileId">{copy.useCase}</Label>
        <select aria-describedby={describedBy("transactionalProfileId", !profiles?.length, Boolean(profileErrors?.length))} aria-invalid={profileErrors?.length ? true : undefined} className="h-10 rounded-md border bg-card px-3 text-sm" defaultValue={state.values.transactionalProfileId ?? ""} disabled={disabled} id="transactionalProfileId" key={state.values.transactionalProfileId ?? ""} name="transactionalProfileId" required>
          <option value="">{copy.select}</option>
          {profiles?.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
        </select>
        {!profiles?.length ? <p className="text-xs text-muted-foreground" id="transactionalProfileId-hint">{copy.noProfile}</p> : null}
        <FieldError errors={profileErrors} id="transactionalProfileId-error" />
      </div> : null}
      <TextAreaField className="[&_textarea]:min-h-40" defaultValue={template?.body} disabled={disabled} hint={copy.bodyHint} label={copy.body} maxLength={templateLimits.body.max} name="body" placeholder={copy.placeholder} state={state} />
      <FormStatus message={state.message} ok={state.ok} />
      <Button className="h-10 w-fit" disabled={pending || disabled} type="submit">{template ? <Save /> : <Plus />}{pending ? copy.pending : template ? copy.save : copy.submit}</Button>
    </div>
    <TemplatePreview body={draft.body} locale={locale} subject={draft.subject} />
  </form>;
}
