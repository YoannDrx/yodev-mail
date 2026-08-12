import { describe, expect, it } from "vitest";
import { detectAttachmentMime } from "./attachment-scan";

describe("attachment content validation", () => {
  it("recognizes allowed binary signatures", () => {
    expect(detectAttachmentMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]), "application/pdf")).toBe("application/pdf");
    expect(detectAttachmentMime(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe("image/jpeg");
  });

  it("rejects HTML/script payloads disguised as text", () => {
    const payload = new TextEncoder().encode("<script>alert(1)</script>");
    expect(detectAttachmentMime(payload, "text/plain")).toBeNull();
  });

  it("validates JSON syntax", () => {
    expect(detectAttachmentMime(new TextEncoder().encode('{"ok":true}'), "application/json")).toBe("application/json");
    expect(detectAttachmentMime(new TextEncoder().encode("not-json"), "application/json")).toBeNull();
  });
});
