import { describe, expect, it } from "vitest";
import { extractTemplateVariables, renderApprovedTemplate, TemplateVariablesMissingError } from "./render";

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
});
