import { ZodError } from "zod";

// Shared result shape for Server Actions driven by useActionState: the form
// stays on the page, keeps what the user typed and announces what went wrong.
export type FieldErrors = Partial<Record<string, string[]>>;

export type ActionState<TData = undefined> = {
  ok: boolean;
  message: string;
  fieldErrors: FieldErrors;
  values: Record<string, string>;
  data?: TData;
};

export function initialActionState<TData = undefined>(): ActionState<TData> {
  return { ok: false, message: "", fieldErrors: {}, values: {} };
}

// Echo text fields back so an invalid submission never wipes the form.
// Files and secrets must never be echoed: callers list the safe field names.
export function formValues(formData: FormData, fields: readonly string[]) {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value === "string") values[field] = value;
  }
  return values;
}

export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path.map(String).join(".") || "_form";
    (fieldErrors[field] ??= []).push(issue.message);
  }
  return fieldErrors;
}

export function actionSuccess<TData = undefined>(
  message: string,
  data?: TData,
): ActionState<TData> {
  return { ok: true, message, fieldErrors: {}, values: {}, data };
}

export function actionFailure<TData = undefined>(
  message: string,
  options: { fieldErrors?: FieldErrors; values?: Record<string, string> } = {},
): ActionState<TData> {
  return {
    ok: false,
    message,
    fieldErrors: options.fieldErrors ?? {},
    values: options.values ?? {},
  };
}
