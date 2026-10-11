import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { apiBaseUrl, templateCurlExample } from "@/features/templates/api-example";
import { previewTemplate, templateHtmlFromText } from "@/features/templates/document";
import { sendEmailSchema } from "@/features/emails/schema";

describe("template documents", () => {
  it("escapes customer text and keeps variables renderable", () => {
    const html = templateHtmlFromText("Bonjour {{firstName}},\n<script>alert(1)</script>\n\nMerci");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("{{firstName}}");
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it("previews with the API renderer and escapes variable values", () => {
    const preview = previewTemplate({ subject: "Reçu {{orderId}}", html: templateHtmlFromText("Bonjour {{firstName}}"), plainText: "Bonjour {{firstName}}" });
    expect(preview.variables).toEqual(["firstName", "orderId"]);
    expect(preview.subject).toBe("Reçu [orderId]");
    expect(preview.document).toContain("Bonjour [firstName]");
    expect(preview.document).not.toMatch(/<script/i);
  });
});

describe("template API example", () => {
  const curl = templateCurlExample({
    baseUrl: "http://localhost:3000",
    templateId: "6f4bd0b2-3b31-4b55-9a59-6a5c8ef7c8d1",
    category: "receipt",
    fromDomain: "client.example",
    variables: ["firstName", "it's"],
  });

  it("targets the test mode with a placeholder key", () => {
    expect(curl).toContain("Authorization: Bearer ym_test_VOTRE_CLE");
    expect(curl).toContain("Idempotency-Key");
    expect(curl).not.toContain("ym_live_");
  });

  it("produces a body accepted by the public send schema, through a real shell", () => {
    // Replace curl by printf to read back exactly what the shell would send.
    const data = execFileSync("bash", ["-c", curl.replace(/^curl[\s\S]*?--data /, "printf %s ")]).toString();
    const parsed = sendEmailSchema.safeParse(JSON.parse(data));
    expect(parsed.success).toBe(true);
    expect(JSON.parse(data).content.variables).toEqual({ firstName: "[firstName]", "it's": "[it's]" });
  });

  it("uses the dedicated API host in production only", () => {
    expect(apiBaseUrl("https://mail.yodev.fr")).toBe("https://api.mail.yodev.fr");
    expect(apiBaseUrl("http://localhost:3918")).toBe("http://localhost:3918");
  });
});
