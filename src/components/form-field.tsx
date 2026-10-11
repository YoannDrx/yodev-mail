import type { ReactNode } from "react";
import { FieldError } from "@/components/form-status";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/utils";

type FieldState = Pick<ActionState<unknown>, "fieldErrors" | "values">;

type FieldProps = {
  name: string;
  label: string;
  state: FieldState;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  minLength?: number;
  maxLength?: number;
  className?: string;
  id?: string;
};

export function describedBy(id: string, hint: boolean, error: boolean) {
  return [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
}

function FieldShell({ id, label, hint, errors, className, children }: { id: string; label: string; hint?: string; errors?: string[]; className?: string; children: ReactNode }) {
  return <div className={cn("grid gap-2", className)}>
    <Label htmlFor={id}>{label}</Label>
    {children}
    {hint ? <p className="text-xs text-muted-foreground" id={`${id}-hint`}>{hint}</p> : null}
    <FieldError errors={errors} id={`${id}-error`} />
  </div>;
}

/** Text input bound to an ActionState: keeps the submitted value and exposes its error. */
export function TextField({ type = "text", min, max, pattern, defaultValue, ...props }: FieldProps & { type?: string; min?: number; max?: number; pattern?: string; defaultValue?: string }) {
  const id = props.id ?? props.name;
  const errors = props.state.fieldErrors[props.name];
  return <FieldShell className={props.className} errors={errors} hint={props.hint} id={id} label={props.label}>
    <Input
      aria-describedby={describedBy(id, Boolean(props.hint), Boolean(errors?.length))}
      aria-invalid={errors?.length ? true : undefined}
      className="h-10"
      defaultValue={props.state.values[props.name] ?? defaultValue}
      disabled={props.disabled}
      id={id}
      max={max}
      maxLength={props.maxLength}
      min={min}
      minLength={props.minLength}
      name={props.name}
      pattern={pattern}
      placeholder={props.placeholder}
      required={props.required ?? true}
      type={type}
    />
  </FieldShell>;
}

export function TextAreaField({ defaultValue, rows, onInput, ...props }: FieldProps & { defaultValue?: string; rows?: number; onInput?: (value: string) => void }) {
  const id = props.id ?? props.name;
  const errors = props.state.fieldErrors[props.name];
  return <FieldShell className={props.className} errors={errors} hint={props.hint} id={id} label={props.label}>
    <Textarea
      aria-describedby={describedBy(id, Boolean(props.hint), Boolean(errors?.length))}
      aria-invalid={errors?.length ? true : undefined}
      defaultValue={props.state.values[props.name] ?? defaultValue}
      disabled={props.disabled}
      id={id}
      maxLength={props.maxLength}
      minLength={props.minLength}
      name={props.name}
      onInput={onInput ? (event) => onInput(event.currentTarget.value) : undefined}
      placeholder={props.placeholder}
      required={props.required ?? true}
      rows={rows}
    />
  </FieldShell>;
}
