import { describe, expect, it } from "vitest";
import { formatMailbox } from "./mailbox";

// Minimal RFC 2047 "B" decoder used only to prove the encoding round-trips.
function decodeEncodedWords(value: string) {
  return value
    .split(" ")
    .map((word) => {
      const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(word);
      if (!match) throw new Error(`Not an encoded-word: ${word}`);
      return Buffer.from(match[1], "base64");
    })
    .reduce((all, bytes) => Buffer.concat([all, bytes]), Buffer.alloc(0))
    .toString("utf8");
}

describe("RFC 5322 mailbox formatting", () => {
  it("leaves a bare address untouched", () => {
    expect(formatMailbox({ email: "a@example.test" })).toBe("a@example.test");
    expect(formatMailbox({ email: "a@example.test", name: "  " })).toBe("a@example.test");
  });

  it("quotes ASCII names so separators stay inside the display name", () => {
    expect(formatMailbox({ email: "a@example.test", name: "x@other.test, Bob" }))
      .toBe('"x@other.test, Bob" <a@example.test>');
    expect(formatMailbox({ email: "a@example.test", name: "Smith; Jane: <boss>" }))
      .toBe('"Smith; Jane: <boss>" <a@example.test>');
  });

  it("escapes quotes and backslashes", () => {
    expect(formatMailbox({ email: "a@example.test", name: 'Bob" <evil@other.test>, "x' }))
      .toBe('"Bob\\" <evil@other.test>, \\"x" <a@example.test>');
    expect(formatMailbox({ email: "a@example.test", name: "back\\slash\\" }))
      .toBe('"back\\\\slash\\\\" <a@example.test>');
  });

  it("removes control characters instead of folding them into headers", () => {
    expect(formatMailbox({ email: "a@example.test", name: "Yodev\r\nBcc: hidden@other.test" }))
      .toBe('"Yodev Bcc: hidden@other.test" <a@example.test>');
  });

  it("encodes accents and emoji as RFC 2047 encoded-words", () => {
    for (const name of ["Société Générale", "Zoë 📬 Équipe", "x@other.test, Zoé", "É".repeat(140), "👩‍💻".repeat(30)]) {
      const formatted = formatMailbox({ email: "a@example.test", name });
      const match = /^(.*) <a@example\.test>$/.exec(formatted);
      expect(match).not.toBeNull();
      const words = match![1];
      expect(words).not.toMatch(/[,;:"<>@\\]/);
      expect(words.split(" ").every((word) => word.length <= 75)).toBe(true);
      expect(decodeEncodedWords(words)).toBe(name);
    }
  });
});
