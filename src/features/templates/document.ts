import { extractTemplateVariables, renderApprovedTemplate } from "@/features/templates/render";

export const templateLimits = {
  name: { min: 2, max: 160 },
  subject: { min: 1, max: 255 },
  body: { min: 1, max: 100_000 },
} as const;

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

/**
 * Builds the stored HTML from the plain-text body. Every character typed by
 * the customer is escaped; only paragraphs and line breaks are generated.
 */
export function templateHtmlFromText(body: string) {
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18151f">${body.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("")}</div>`;
}

/** Sample value displayed for each variable in previews and examples. */
export function sampleVariables(variables: string[]) {
  return Object.fromEntries(variables.map((name) => [name, `[${name}]`]));
}

/**
 * Renders a template exactly as the API would (same renderer, same escaping),
 * with visible sample values, as a standalone document for a sandboxed iframe.
 */
export function previewTemplate(input: { subject: string; html: string; plainText: string }) {
  const variables = extractTemplateVariables(input.subject, input.html, input.plainText);
  const rendered = renderApprovedTemplate({ ...input, variables: sampleVariables(variables) });
  return {
    variables,
    subject: rendered.subject,
    document: `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light"><style>body{margin:0;padding:16px;background:#fff}</style></head><body>${rendered.html}</body></html>`,
  };
}
