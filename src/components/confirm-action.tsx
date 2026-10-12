"use client";

import { useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
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

function ConfirmSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} type="submit" variant="destructive">
      {pending ? pendingLabel : label}
    </Button>
  );
}

// Destructive or irreversible actions go through an explicit confirmation.
// The action runs from a real form, so it keeps working as a Server Action.
export function ConfirmAction({
  action,
  fields = {},
  trigger,
  triggerVariant = "outline",
  disabled = false,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  fields?: Record<string, string>;
  trigger: ReactNode;
  triggerVariant?: "outline" | "destructive" | "ghost";
  disabled?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
}) {
  const [open, setOpen] = useState(false);
  // Close once the action settles: the trigger usually stays on the page after
  // revalidation, so an uncontrolled dialog would remain open over the result.
  const submit = async (formData: FormData) => {
    await action(formData);
    setOpen(false);
  };
  return (
    <AlertDialog onOpenChange={setOpen} open={open}>
      <AlertDialogTrigger asChild>
        <Button disabled={disabled} size="sm" type="button" variant={triggerVariant}>
          {trigger}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <form action={submit}>
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          <AlertDialogFooter>
            <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
            <ConfirmSubmit label={confirmLabel} pendingLabel={pendingLabel} />
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
