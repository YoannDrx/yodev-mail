import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { localeAlternates, publicPageMetadata } from "@/lib/public-metadata";
import { siteConfig } from "@/lib/site-config";

describe("robots.txt", () => {
  const rules = robots().rules;
  const disallow = (Array.isArray(rules) ? rules[0] : rules).disallow as string[];

  it("blocks the locale-prefixed private routes that are actually served", () => {
    for (const locale of ["fr", "en"]) {
      for (const route of ["/dashboard", "/admin", "/onboarding", "/invitation", "/connexion", "/mot-de-passe-oublie", "/reinitialiser-mot-de-passe"]) {
        expect(disallow).toContain(`/${locale}${route}`);
      }
    }
    expect(disallow).toEqual(expect.arrayContaining(["/dashboard", "/admin", "/api", "/v1"]));
  });

  it("keeps public pages crawlable and points at the configured host", () => {
    for (const path of ["/fr/tarifs", "/en/docs", "/fr/inscription", "/fr/contact"]) {
      expect(disallow.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))).toBe(false);
    }
    expect(robots().sitemap).toBe(`${siteConfig.appUrl}/sitemap.xml`);
  });
});

describe("sitemap", () => {
  it("lists every public page in both locales on the configured host with x-default", () => {
    const entries = sitemap();
    expect(entries.every((entry) => entry.url.startsWith(`${siteConfig.appUrl}/`))).toBe(true);
    const tarifs = entries.find((entry) => entry.url === `${siteConfig.appUrl}/en/tarifs`);
    expect(tarifs?.alternates?.languages).toEqual({
      fr: `${siteConfig.appUrl}/fr/tarifs`,
      en: `${siteConfig.appUrl}/en/tarifs`,
      "x-default": `${siteConfig.appUrl}/tarifs`,
    });
    expect(entries.map((entry) => entry.url)).toEqual(expect.arrayContaining([`${siteConfig.appUrl}/fr/contact`, `${siteConfig.appUrl}/en/sous-traitants`]));
    expect(entries.some((entry) => /dashboard|admin|onboarding|connexion/.test(entry.url))).toBe(false);
  });
});

describe("public metadata", () => {
  it("publishes canonical, hreflang and x-default alternates", () => {
    expect(localeAlternates("en", "/fr/docs")).toEqual({
      canonical: `${siteConfig.appUrl}/en/docs`,
      languages: { fr: `${siteConfig.appUrl}/fr/docs`, en: `${siteConfig.appUrl}/en/docs`, "x-default": `${siteConfig.appUrl}/docs` },
    });
    expect(localeAlternates("fr", "/").canonical).toBe(`${siteConfig.appUrl}/fr`);
  });

  it("uses a localized social image", () => {
    const metadata = publicPageMetadata("en", "/tarifs", { title: "Pricing", description: "Beta pricing." });
    expect(metadata.title).toBe("Pricing");
    expect(JSON.stringify(metadata.openGraph)).toContain("/opengraph-image?locale=en");
    expect(JSON.stringify(publicPageMetadata("fr", "/", { description: "x" }).openGraph)).toContain("/opengraph-image?locale=fr");
  });
});
