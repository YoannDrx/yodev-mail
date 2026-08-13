export type TemplateVariables = Record<string, string | number | boolean | null>;

const placeholderPattern = /{{\s*([\w.]+)\s*}}/g;

export class TemplateVariablesMissingError extends Error {
  constructor(readonly missingVariables: string[]) {
    super("Required template variables are missing");
    this.name = "TemplateVariablesMissingError";
  }
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
    const rendered = String(variables[name] ?? "");
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
  const missing = required.filter((name) => !(name in input.variables));
  if (missing.length) throw new TemplateVariablesMissingError(missing);

  return {
    subject: replace(input.subject, input.variables, false).replace(/[\r\n]+/g, " ").trim(),
    html: replace(input.html, input.variables, true),
    plainText: replace(input.plainText, input.variables, false),
  };
}
