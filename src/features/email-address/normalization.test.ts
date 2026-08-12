import { describe, expect, it } from "vitest";
import { normalizeEmail, suppressionHash } from "./normalization";

describe("transactional recipient normalization", () => {
  it("normalizes whitespace and case", () => {
    expect(normalizeEmail(" Person@Example.COM ")).toBe("person@example.com");
  });
  it("creates a stable workspace suppression hash", () => {
    expect(suppressionHash("A@example.com")).toBe(suppressionHash("a@EXAMPLE.com"));
  });
});
