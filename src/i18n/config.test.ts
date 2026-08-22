import { describe, expect, test } from "vitest";
import {
  isMachinePath,
  localeFromPathname,
  localizedPath,
  negotiateLocale,
  stripLocale,
} from "./config";

describe("locale routing", () => {
  test("negotiates a supported locale and gives the cookie priority", () => {
    expect(negotiateLocale("en-US,en;q=0.9,fr;q=0.8")).toBe("en");
    expect(negotiateLocale("en-US,en;q=0.9", "fr")).toBe("fr");
    expect(negotiateLocale("de-DE,de;q=0.9")).toBe("fr");
    expect(negotiateLocale("en;q=0")).toBe("fr");
  });

  test("adds, replaces and removes locale prefixes", () => {
    expect(localeFromPathname("/fr/dashboard")).toBe("fr");
    expect(localeFromPathname("/en")).toBe("en");
    expect(stripLocale("/fr/dashboard/emails")).toBe("/dashboard/emails");
    expect(stripLocale("/en")).toBe("/");
    expect(localizedPath("en", "/fr/dashboard")).toBe("/en/dashboard");
    expect(localizedPath("fr", "/")).toBe("/fr");
  });

  test("never localizes public machine contracts", () => {
    for (const pathname of ["/api/health", "/v1/emails", "/health", "/openapi.json"]) {
      expect(isMachinePath(pathname)).toBe(true);
      expect(localizedPath("en", pathname)).toBe(pathname);
    }
  });
});
