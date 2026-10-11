import { describe, expect, it } from "vitest";
import {
  extractTemplateVariables,
  MAX_TEMPLATE_VARIABLE_LENGTH,
  renderApprovedTemplate,
  TemplateVariablesMissingError,
  TemplateVariablesTooLongError,
} from "./render";

describe("approved template rendering", () => {
  it("extracts dotted variables and rejects missing required values", () => {
    expect(extractTemplateVariables("{{ source.id }}", "{{label}}", "{{ source.id }}")).toEqual(["label", "source.id"]);
    expect(() => renderApprovedTemplate({ subject: "{{label}}", html: "{{source.id}}", plainText: "ok", variables: { label: "A" } }))
      .toThrow(TemplateVariablesMissingError);
  });

  it("escapes HTML values but preserves plain text and dotted keys", () => {
    const rendered = renderApprovedTemplate({
      subject: "Alert {{label}}\r\nBcc: hostile@example.test",
      html: "<p>{{source.id}}</p>",
      plainText: "{{source.id}}",
      variables: { label: "ops", "source.id": "<script>alert('x')</script>" },
    });
    expect(rendered.subject).toBe("Alert ops Bcc: hostile@example.test");
    expect(rendered.html).toContain("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;");
    expect(rendered.plainText).toBe("<script>alert('x')</script>");
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"])(
    "treats the inherited name %s as missing instead of rendering the prototype",
    (name) => {
      const template = { subject: "Hello", html: `<p>{{${name}}}</p>`, plainText: `{{${name}}}` };
      expect(() => renderApprovedTemplate({ ...template, variables: {} })).toThrow(TemplateVariablesMissingError);
      expect(renderApprovedTemplate({ ...template, variables: { [name]: "ok" } }).plainText).toBe("ok");
    },
  );

  it("refuses variables long enough to smuggle a whole message", () => {
    const template = { subject: "Receipt", html: "<p>{{body}}</p>", plainText: "{{body}}" };
    expect(renderApprovedTemplate({ ...template, variables: { body: "x".repeat(MAX_TEMPLATE_VARIABLE_LENGTH) } }).plainText)
      .toHaveLength(MAX_TEMPLATE_VARIABLE_LENGTH);
    expect(() => renderApprovedTemplate({ ...template, variables: { body: "x".repeat(MAX_TEMPLATE_VARIABLE_LENGTH + 1) } }))
      .toThrow(TemplateVariablesTooLongError);
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`v${index}`, "x".repeat(2_000)]));
    expect(() => renderApprovedTemplate({ ...template, variables: { body: "ok", ...many } })).toThrow(TemplateVariablesTooLongError);
  });
});
