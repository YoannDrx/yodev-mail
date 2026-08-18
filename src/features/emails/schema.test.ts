import { describe, expect, it } from "vitest";
import { attachmentUploadSchema, estimatedMimeSize, sendEmailSchema } from "./schema";

const base = {
  from: { email: "sender@example.com" },
  to: { email: "recipient@example.net" },
  category: "payment_receipt",
};

describe("transactional email schema", () => {
  it("accepts one recipient with an approved-template shape", () => {
    expect(sendEmailSchema.safeParse({
      ...base,
      content: { templateId: crypto.randomUUID(), variables: { invoice: "INV-1" } },
    }).success).toBe(true);
  });

  it("accepts raw content within the shared size ceiling", () => {
    expect(sendEmailSchema.safeParse({
      ...base,
      content: { subject: "Votre reçu", html: "<p>Bonjour</p>", text: "Bonjour" },
      metadata: {
        referenceId: "payment:invoice:INV-1",
        workspaceId: "00000000-0000-4000-8000-000000000001",
      },
    }).success).toBe(true);
  });

  it("rejects malformed source workspace metadata and unknown metadata fields", () => {
    expect(sendEmailSchema.safeParse({
      ...base,
      content: { subject: "Test", html: "<p>Test</p>", text: "Test" },
      metadata: { workspaceId: "not-a-uuid" },
    }).success).toBe(false);
    expect(sendEmailSchema.safeParse({
      ...base,
      content: { subject: "Test", html: "<p>Test</p>", text: "Test" },
      metadata: { source: "unapproved" },
    }).success).toBe(false);
  });

  it("rejects provider, tracking and multi-recipient fields", () => {
    expect(sendEmailSchema.safeParse({
      ...base,
      provider: "postmark",
      tracking: { opens: true },
      content: { subject: "Test", html: "<p>Test</p>", text: "Test" },
    }).success).toBe(false);
    expect(sendEmailSchema.safeParse({
      ...base,
      to: [{ email: "one@example.net" }, { email: "two@example.net" }],
      content: { subject: "Test", html: "<p>Test</p>", text: "Test" },
    }).success).toBe(false);
  });

  it("rejects control characters in display names", () => {
    expect(sendEmailSchema.safeParse({
      ...base,
      from: { email: "sender@example.com", name: "Yodev\r\nBcc: hidden@example.net" },
      content: { subject: "Test", html: "<p>Test</p>", text: "Test" },
    }).success).toBe(false);
  });

  it("accepts only the attachment allowlist", () => {
    expect(attachmentUploadSchema.safeParse({
      fileName: "facture.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    }).success).toBe(true);
    expect(attachmentUploadSchema.safeParse({
      fileName: "payload.svg",
      contentType: "image/svg+xml",
      sizeBytes: 1024,
      sha256: "a".repeat(64),
    }).success).toBe(false);
  });

  it("caps template variables and estimates encoded MIME size", () => {
    expect(sendEmailSchema.safeParse({
      ...base,
      content: { templateId: crypto.randomUUID(), variables: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`v${index}`, "x"])) },
    }).success).toBe(false);
    expect(estimatedMimeSize(512_000, 6 * 1024 * 1024, 5)).toBeLessThan(9 * 1024 * 1024);
    expect(estimatedMimeSize(512_000, 7 * 1024 * 1024, 5)).toBeGreaterThan(9 * 1024 * 1024);
  });
});
