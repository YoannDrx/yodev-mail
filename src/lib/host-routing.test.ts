import { describe, expect, test } from "vitest";
import { canonicalUrlForHost } from "./host-routing";

describe("canonical host routing", () => {
  test("moves API routes to the API host", () => {
    expect(canonicalUrlForHost("mail.yodev.fr", new URL("https://mail.yodev.fr/v1/emails"))?.toString())
      .toBe("https://api.mail.yodev.fr/v1/emails");
  });

  test("moves unsubscribe routes to the links host", () => {
    expect(canonicalUrlForHost("mail.yodev.fr", new URL("https://mail.yodev.fr/u/token"))?.toString())
      .toBe("https://links.mail.yodev.fr/u/token");
  });

  test("does not expose the dashboard on a public service host", () => {
    expect(canonicalUrlForHost("api.mail.yodev.fr", new URL("https://api.mail.yodev.fr/dashboard"))?.toString())
      .toBe("https://mail.yodev.fr/");
    expect(canonicalUrlForHost("links.mail.yodev.fr", new URL("https://links.mail.yodev.fr/dashboard"))?.toString())
      .toBe("https://mail.yodev.fr/");
  });

  test("serves the conventional health endpoint on both service hosts", () => {
    expect(canonicalUrlForHost("api.mail.yodev.fr", new URL("https://api.mail.yodev.fr/health")))
      .toBeNull();
    expect(canonicalUrlForHost("links.mail.yodev.fr", new URL("https://links.mail.yodev.fr/health")))
      .toBeNull();
    expect(canonicalUrlForHost("mail.yodev.fr", new URL("https://mail.yodev.fr/health"))?.toString())
      .toBe("https://api.mail.yodev.fr/health");
  });

  test("leaves localhost and previews untouched", () => {
    expect(canonicalUrlForHost("localhost:3000", new URL("http://localhost:3000/v1/emails"))).toBeNull();
  });
});
