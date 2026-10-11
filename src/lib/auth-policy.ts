// Pure authentication policy shared by the Better Auth configuration, its
// route handler and the sign-in pages. No secrets, sessions or I/O here.

/** Stable code carried by the Better Auth error redirect for non-invited sign-ups. */
export const INVITATION_REQUIRED = "INVITATION_REQUIRED";

// The interface only calls these organization endpoints (account menu and
// invitation panel). Every other organization route bypasses the application
// rules (approved workspace, seat limit, audit) and stays closed.
export const allowedOrganizationPaths = [
  "/organization/accept-invitation",
  "/organization/list",
  "/organization/set-active",
] as const;

const organizationPaths = [
  "accept-invitation", "add-team-member", "cancel-invitation", "check-slug", "create",
  "create-role", "create-team", "delete", "delete-role", "get-active-member",
  "get-active-member-role", "get-full-organization", "get-invitation", "get-role",
  "has-permission", "invite-member", "leave", "list", "list-invitations", "list-members",
  "list-roles", "list-team-members", "list-teams", "list-user-invitations", "list-user-teams",
  "reject-invitation", "remove-member", "remove-team", "remove-team-member", "set-active",
  "set-active-team", "update", "update-member-role", "update-role", "update-team",
].map((path) => `/organization/${path}`);

// The admin plugin only supplies the platform role on the user. Its HTTP
// endpoints (impersonation included) are never used by the interface.
const adminPaths = [
  "ban-user", "create-user", "get-user", "has-permission", "impersonate-user",
  "list-user-sessions", "list-users", "remove-user", "revoke-user-session",
  "revoke-user-sessions", "set-role", "set-user-password", "stop-impersonating",
  "unban-user", "update-user",
].map((path) => `/admin/${path}`);

// Accounts are created by invitation through Google only, so a local account
// can never be registered first and block the real owner's Google sign-in.
const closedAccountPaths = ["/sign-up/email", "/link-social", "/unlink-account"];

const passwordResetPaths = ["/request-password-reset", "/forget-password", "/reset-password"];

export function disabledAuthPaths(options: { emailPasswordEnabled: boolean }) {
  return [
    ...organizationPaths.filter(
      (path) => !(allowedOrganizationPaths as readonly string[]).includes(path),
    ),
    ...adminPaths,
    ...closedAccountPaths,
    ...(options.emailPasswordEnabled ? [] : passwordResetPaths),
  ];
}

/**
 * Second line of defence in the route handler: Better Auth matches
 * `disabledPaths` exactly, so normalise the path and also close prefixes
 * (e.g. `/reset-password/:token`, future organization or admin routes).
 */
export function isDisabledAuthPath(
  pathname: string,
  options: { emailPasswordEnabled: boolean },
) {
  const path = (
    pathname
      .replace(/\/{2,}/g, "/")
      .replace(/^\/api\/auth(?=\/|$)/, "")
      .replace(/\/+$/, "") || "/"
  ).toLowerCase();
  if (path.startsWith("/organization/") || path === "/organization") {
    return !(allowedOrganizationPaths as readonly string[]).includes(path);
  }
  if (path === "/admin" || path.startsWith("/admin/")) return true;
  if (closedAccountPaths.includes(path)) return true;
  if (!options.emailPasswordEnabled) {
    return passwordResetPaths.some((closed) => path === closed || path.startsWith(`${closed}/`));
  }
  return false;
}

export type SignInProblem =
  | "invitation_required"
  | "session_expired"
  | "account_not_linked"
  | "cancelled"
  | "bootstrap_ambiguous"
  | "generic";

const sessionExpiredCodes = new Set([
  "state_mismatch",
  "state_not_found",
  "state_invalid",
  "please_restart_the_process",
  "invalid_code",
  "no_code",
  "no_callback_url",
  "invalid_callback_request",
]);

const accountNotLinkedCodes = new Set([
  "account_not_linked",
  "unable_to_link_account",
  "email_doesn't_match",
  "account_already_linked_to_different_user",
]);

/**
 * Maps the Better Auth `error` parameter and our own `erreur` parameter to a
 * user-facing problem. Unknown values fall back to a generic message instead
 * of being echoed back to the page.
 */
export function signInProblem(params: { error?: string | readonly string[]; erreur?: string | readonly string[] }): SignInProblem | null {
  const error = first(params.error)?.trim();
  const erreur = first(params.erreur)?.trim();
  if (erreur === "bootstrap") return "bootstrap_ambiguous";
  if (!error && !erreur) return null;
  if (!error) return "generic";
  if (error.toUpperCase() === INVITATION_REQUIRED || error === "signup_disabled") {
    return "invitation_required";
  }
  const code = error.toLowerCase();
  if (code === "access_denied") return "cancelled";
  if (sessionExpiredCodes.has(code)) return "session_expired";
  if (accountNotLinkedCodes.has(code)) return "account_not_linked";
  return "generic";
}

/**
 * Accepts only a same-origin relative path for the post-sign-in destination.
 * Absolute URLs, protocol-relative `//host`, backslash tricks, control
 * characters and API routes all fall back to the dashboard.
 */
export function safeRedirectPath(value: unknown, fallback = "/dashboard") {
  const candidate = first(value as string | readonly string[] | undefined);
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 2_048) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  // Browsers treat "\" as "/" and strip tabs/newlines before resolving a URL.
  if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return fallback;
  const base = "http://mail.invalid";
  let url: URL;
  try {
    url = new URL(candidate, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  const path = url.pathname.replace(/^\/(fr|en)(?=\/|$)/, "") || "/";
  if (path === "/connexion" || path.startsWith("/connexion/") || path === "/api" || path.startsWith("/api/")) {
    return fallback;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function first(value: string | readonly string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
