import { describe, expect, it } from "vitest";
import { mergeImportedConsent, normalizeEmail, suppressionHash } from "./normalization";

describe("contact normalization", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeEmail(" Person@Example.COM ")).toBe("person@example.com");
  });

  it("never withdraws an existing consent during import", () => {
    expect(mergeImportedConsent(true, false)).toBe(true);
  });

  it("never upgrades an imported consent without evidence", () => {
    expect(mergeImportedConsent(false, true)).toBe(false);
    expect(mergeImportedConsent(false, true, true)).toBe(true);
  });

  it("creates a stable suppression hash", () => {
    expect(suppressionHash("A@example.com")).toBe(suppressionHash("a@EXAMPLE.com"));
  });
});
