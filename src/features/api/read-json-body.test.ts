import { describe, expect, it } from "vitest";
import {
  readBodyText,
  readJsonBody,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "./read-json-body";

describe("bounded JSON request bodies", () => {
  it("parses a valid JSON body below the limit", async () => {
    const request = new Request("https://mail.example/v1/emails", {
      body: JSON.stringify({ ok: true }),
      headers: { "content-type": "application/json; charset=utf-8" },
      method: "POST",
    });
    await expect(readJsonBody(request, 1_024)).resolves.toEqual({ ok: true });
  });

  it("rejects an oversized streamed body even without content-length", async () => {
    const request = new Request("https://mail.example/v1/emails", {
      body: JSON.stringify({ value: "x".repeat(200) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    await expect(readJsonBody(request, 32)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("bounds raw signed webhook bodies before buffering them", async () => {
    const request = new Request("https://mail.example/api/stripe/webhook", {
      body: "x".repeat(200),
      method: "POST",
    });
    await expect(readBodyText(request, 32)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("rejects non-JSON media types", async () => {
    const request = new Request("https://mail.example/v1/emails", {
      body: "ok=true",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    await expect(readJsonBody(request, 1_024)).rejects.toBeInstanceOf(UnsupportedMediaTypeError);
  });
});
