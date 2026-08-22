import { describe, expect, test } from "vitest";
import { buildAuthEmailContent } from "./auth-email";

describe("authentication email localization", () => {
  test("renders French and English in a single invitation email", () => {
    const result = buildAuthEmailContent({
      actionUrl: "https://mail.yodev.fr/fr/invitation?id=abc",
      intro: "Vous êtes invité à rejoindre Acme.",
      kind: "organization_invitation",
    });
    expect(result.subject).toContain("Invitation");
    expect(result.html).toContain('lang="fr"');
    expect(result.html).toContain('lang="en"');
    expect(result.html).toContain("Continue to Mail by Yodev");
    expect(result.text).toContain("Vous êtes invité");
    expect(result.text).toContain("You have been invited");
  });

  test("escapes untrusted organization names and action URLs in HTML", () => {
    const result = buildAuthEmailContent({
      actionUrl: 'https://example.com/?next="unsafe"&x=1',
      intro: "<script>alert('x')</script>",
      kind: "security_alert",
    });
    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("&quot;unsafe&quot;&amp;x=1");
  });
});
