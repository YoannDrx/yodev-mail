import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/content-security-policy";
import proxy from "./proxy";

function scriptSrc(policy: string | null) {
  return policy?.split(";").map((directive) => directive.trim()).find((directive) => directive.startsWith("script-src")) ?? "";
}

describe("content security policy", () => {
  it("never allows inline scripts without the request nonce", () => {
    for (const development of [false, true]) {
      const policy = contentSecurityPolicy("abc123", { development });
      expect(scriptSrc(policy)).toContain("'nonce-abc123'");
      expect(scriptSrc(policy)).toContain("'strict-dynamic'");
      expect(scriptSrc(policy)).not.toContain("'unsafe-inline'");
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("base-uri 'self'");
      expect(policy).toContain("form-action 'self'");
    }
    expect(scriptSrc(contentSecurityPolicy("n"))).not.toContain("'unsafe-eval'");
    expect(scriptSrc(contentSecurityPolicy("n", { development: true }))).toContain("'unsafe-eval'");
  });

  it("issues a fresh nonce per page request and forwards it to rendering", () => {
    const first = proxy(new NextRequest("https://mail.yodev.fr/fr/tarifs"));
    const second = proxy(new NextRequest("https://mail.yodev.fr/fr/tarifs"));
    const firstPolicy = first.headers.get("content-security-policy");
    const nonce = first.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
    expect(scriptSrc(firstPolicy)).toContain(`'nonce-${nonce}'`);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(firstPolicy);
    expect(second.headers.get("x-middleware-request-x-nonce")).not.toBe(nonce);
  });

  it("overrides a client-supplied nonce header", () => {
    const response = proxy(new NextRequest("https://mail.yodev.fr/en", { headers: { "x-nonce": "attacker" } }));
    expect(response.headers.get("x-middleware-request-x-nonce")).not.toBe("attacker");
    expect(response.headers.get("content-security-policy")).not.toContain("attacker");
  });

  it("protects machine routes such as social images with the same policy", () => {
    const response = proxy(new NextRequest("https://mail.yodev.fr/opengraph-image?locale=en"));
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(scriptSrc(response.headers.get("content-security-policy"))).not.toContain("'unsafe-inline'");
  });
});
