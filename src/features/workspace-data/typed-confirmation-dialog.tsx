"use client";

import { useActionState, useState, type ReactNode } from "react";
import { FieldError, FormStatus } from "@/components/form-status";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ActionState, initialActionState } from "@/lib/action-state";

/**
 * Irreversible actions: the person must type an exact value (a workspace
 * name, an email) before the destructive button is enabled. The server
 * action checks the typed value again.
 */
export function TypedConfirmationDialog({
  action,
  fieldName,
  expected,
  caseInsensitive = false,
  trigger,
  title,
  description,
  fieldLabel,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  children,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  fieldName: string;
  expected: string;
  caseInsensitive?: boolean;
  trigger: string;
  title: string;
  description: string;
  fieldLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
  children?: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState());
  const [typed, setTyped] = useState("");
  const normalize = (value: string) => (caseInsensitive ? value.trim().toLowerCase() : value.trim());
  const matches = typed !== "" && normalize(typed) === normalize(expected);
  const inputId = `confirm-${fieldName}`;
  return (
    <AlertDialog onOpenChange={(open) => { if (!open) setTyped(""); }}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="destructive">{trigger}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={formAction} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={inputId}>{fieldLabel}</Label>
            <Input
              aria-describedby={state.fieldErrors[fieldName] ? `${inputId}-error` : undefined}
              aria-invalid={state.fieldErrors[fieldName] ? true : undefined}
              autoComplete="off"
              id={inputId}
              name={fieldName}
              onChange={(event) => setTyped(event.target.value)}
              spellCheck={false}
              value={typed}
            />
            <FieldError id={`${inputId}-error`} errors={state.fieldErrors[fieldName]} />
          </div>
          {children}
          <FormStatus message={state.message} ok={state.ok} />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{cancelLabel}</AlertDialogCancel>
            <Button disabled={!matches || pending} type="submit" variant="destructive">
              {pending ? pendingLabel : confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
