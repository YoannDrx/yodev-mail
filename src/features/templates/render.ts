export type TemplateVariables = Record<string, string | number | boolean | null>;

const placeholderPattern = /{{\s*([\w.]+)\s*}}/g;

// Variables fill the slots of an approved template; they must never be able
// to carry a whole message past the template-only policy. 2,048 characters
// still fit a long signed URL (password reset, invoice, presigned download).
export const MAX_TEMPLATE_VARIABLE_LENGTH = 2_048;
export const MAX_TEMPLATE_VARIABLES_TOTAL_LENGTH = 8_192;

export class TemplateVariablesMissingError extends Error {
  constructor(readonly missingVariables: string[]) {
    super("Required template variables are missing");
    this.name = "TemplateVariablesMissingError";
  }
}

export class TemplateVariablesTooLongError extends Error {
  constructor(readonly variables: string[]) {
    super("Template variables exceed the allowed length");
    this.name = "TemplateVariablesTooLongError";
  }
}

export function templateVariableLength(value: TemplateVariables[string]) {
  return value === null ? 0 : String(value).length;
}

export function extractTemplateVariables(...values: string[]) {
  const names = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(placeholderPattern)) names.add(match[1]);
  }
  return [...names].sort();
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function replace(value: string, variables: TemplateVariables, html: boolean) {
  return value.replace(placeholderPattern, (_placeholder, name: string) => {
    const rendered = Object.hasOwn(variables, name) ? String(variables[name] ?? "") : "";
    return html ? escapeHtml(rendered) : rendered;
  });
}

export function renderApprovedTemplate(input: {
  subject: string;
  html: string;
  plainText: string;
  variables: TemplateVariables;
}) {
  const required = extractTemplateVariables(input.subject, input.html, input.plainText);
  // `in` would accept inherited names such as `constructor` or `toString`.
  const missing = required.filter((name) => !Object.hasOwn(input.variables, name));
  if (missing.length) throw new TemplateVariablesMissingError(missing);
  const entries = Object.entries(input.variables);
  const tooLong = entries
    .filter(([, value]) => templateVariableLength(value) > MAX_TEMPLATE_VARIABLE_LENGTH)
    .map(([name]) => name)
    .sort();
  const total = entries.reduce((sum, [, value]) => sum + templateVariableLength(value), 0);
  if (tooLong.length || total > MAX_TEMPLATE_VARIABLES_TOTAL_LENGTH) {
    throw new TemplateVariablesTooLongError(tooLong);
  }

  return {
    subject: replace(input.subject, input.variables, false).replace(/[\r\n]+/g, " ").trim(),
    html: replace(input.html, input.variables, true),
    plainText: replace(input.plainText, input.variables, false),
  };
}
