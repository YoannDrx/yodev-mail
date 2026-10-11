import { describe, expect, it } from "vitest";
import {
  allowedOrganizationPaths,
  disabledAuthPaths,
  INVITATION_REQUIRED,
  isDisabledAuthPath,
  safeRedirectPath,
  signInProblem,
} from "./auth-policy";

describe("sign-in error mapping", () => {
  it.each([
    [{ error: INVITATION_REQUIRED }, "invitation_required"],
    [{ error: "invitation_required" }, "invitation_required"],
    [{ error: "signup_disabled" }, "invitation_required"],
    [{ error: "state_mismatch" }, "session_expired"],
    [{ error: "state_not_found" }, "session_expired"],
    [{ error: "please_restart_the_process" }, "session_expired"],
    [{ error: "invalid_code" }, "session_expired"],
    [{ error: "account_not_linked" }, "account_not_linked"],
    [{ error: "unable_to_link_account" }, "account_not_linked"],
    [{ error: "access_denied" }, "cancelled"],
    [{ error: "access_denied", erreur: "oauth" }, "cancelled"],
    [{ erreur: "oauth" }, "generic"],
    [{ erreur: "bootstrap" }, "bootstrap_ambiguous"],
    [{ error: "<script>alert(1)</script>" }, "generic"],
    [{ error: ["state_mismatch", "access_denied"] }, "session_expired"],
  ] as const)("maps %j to %s", (params, expected) => {
    expect(signInProblem(params)).toBe(expected);
  });

  it("shows nothing without an error", () => {
    expect(signInProblem({})).toBeNull();
    expect(signInProblem({ error: "", erreur: "" })).toBeNull();
  });
});

describe("post-sign-in redirect sanitising", () => {
  it.each([
    "/dashboard",
    "/fr/dashboard/emails/123",
    "/fr/invitation?id=abcdefabcdefabcdefabcdef",
    "/en/dashboard/membres#invitations",
  ])("keeps the same-origin path %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    undefined,
    "",
    "dashboard",
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example",
    "/\t/evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "/fr/connexion?next=/fr/connexion",
    "/connexion",
    "/api/auth/sign-out",
    `/${"a".repeat(3_000)}`,
  ])("rejects %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it("uses the requested fallback and the first value of a repeated parameter", () => {
    expect(safeRedirectPath("https://evil.example", "")).toBe("");
    expect(safeRedirectPath(["/fr/dashboard/domaines", "https://evil.example"])).toBe("/fr/dashboard/domaines");
  });
});

describe("closed Better Auth endpoints", () => {
  const closed = disabledAuthPaths({ emailPasswordEnabled: false });

  it("keeps only the organization endpoints used by the interface", () => {
    for (const path of allowedOrganizationPaths) expect(closed).not.toContain(path);
    expect(closed).toEqual(expect.arrayContaining([
      "/organization/invite-member",
      "/organization/update",
      "/organization/update-member-role",
      "/organization/remove-member",
      "/organization/get-invitation",
      "/admin/impersonate-user",
      "/admin/set-role",
      "/sign-up/email",
      "/request-password-reset",
      "/reset-password",
    ]));
  });

  it("only exposes password reset when passwords are enabled", () => {
    expect(disabledAuthPaths({ emailPasswordEnabled: true })).not.toContain("/request-password-reset");
    expect(isDisabledAuthPath("/api/auth/reset-password/token", { emailPasswordEnabled: true })).toBe(false);
  });

  it.each([
    "/api/auth/organization/invite-member",
    "/api/auth//organization/invite-member",
    "/api/auth/organization/invite-member/",
    "/api/auth/organization/Invite-Member",
    "/api/auth/organization/some-future-endpoint",
    "/api/auth/admin/impersonate-user",
    "/api/auth/admin/list-users",
    "/api/auth/sign-up/email",
    "/api/auth/request-password-reset",
    "/api/auth/reset-password/some-token",
  ])("refuses %s in the route handler", (path) => {
    expect(isDisabledAuthPath(path, { emailPasswordEnabled: false })).toBe(true);
  });

  it.each([
    "/api/auth/organization/accept-invitation",
    "/api/auth/organization/set-active",
    "/api/auth/organization/list",
    "/api/auth/get-session",
    "/api/auth/sign-in/social",
    "/api/auth/callback/google",
    "/api/auth/sign-out",
    "/api/auth/passkey/generate-authenticate-options",
  ])("lets %s through", (path) => {
    expect(isDisabledAuthPath(path, { emailPasswordEnabled: false })).toBe(false);
  });
});
