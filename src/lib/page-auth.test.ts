import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class WorkspaceAccessError extends Error {}
  class BootstrapWorkspaceAmbiguousError extends WorkspaceAccessError {}
  return {
    currentWorkspace: vi.fn(),
    getSession: vi.fn(),
    configured: vi.fn(),
    pathname: vi.fn(),
    redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
    notFound: vi.fn((): never => { throw new Error("not-found"); }),
    WorkspaceAccessError,
    BootstrapWorkspaceAmbiguousError,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: <T,>(fn: T) => fn }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/env", () => ({ isBetterAuthConfigured: mocks.configured }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr", getOriginalPathname: mocks.pathname }));
vi.mock("@/lib/current-workspace", () => ({
  currentWorkspace: mocks.currentWorkspace,
  WorkspaceAccessError: mocks.WorkspaceAccessError,
  BootstrapWorkspaceAmbiguousError: mocks.BootstrapWorkspaceAmbiguousError,
}));

import { isPlatformAdmin, requireAdmin, requirePageWorkspace } from "./page-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
  mocks.pathname.mockResolvedValue("/fr/dashboard");
  mocks.getSession.mockResolvedValue({ user: { id: "synthetic-user" } });
});

describe("workspace page access", () => {
  it("returns the authenticated workspace", async () => {
    const context = { workspace: { id: "synthetic-workspace" } };
    mocks.currentWorkspace.mockResolvedValue(context);
    expect(await requirePageWorkspace()).toBe(context);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("routes an expected missing workspace to the recovery page", async () => {
    mocks.currentWorkspace.mockRejectedValue(new mocks.WorkspaceAccessError("No membership"));
    await expect(requirePageWorkspace()).rejects.toThrow("redirect:/fr/onboarding");
  });

  it("explains an ambiguous bootstrap instead of failing with a server error", async () => {
    mocks.currentWorkspace.mockRejectedValue(new mocks.BootstrapWorkspaceAmbiguousError("ambiguous"));
    await expect(requirePageWorkspace()).rejects.toThrow("redirect:/fr/connexion?erreur=bootstrap");
  });

  it("does not disguise a database outage as missing access", async () => {
    const failure = new Error("Database unavailable");
    mocks.currentWorkspace.mockRejectedValue(failure);
    await expect(requirePageWorkspace()).rejects.toBe(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("requires a session before querying a workspace and keeps the requested page", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.pathname.mockResolvedValue("/fr/dashboard/emails/123");
    await expect(requirePageWorkspace()).rejects.toThrow(
      `redirect:/fr/connexion?next=${encodeURIComponent("/fr/dashboard/emails/123")}`,
    );
    expect(mocks.currentWorkspace).not.toHaveBeenCalled();
  });

  it("never forwards an unsafe requested path to the sign-in page", async () => {
    mocks.getSession.mockResolvedValue(null);
    mocks.pathname.mockResolvedValue("//evil.example/phish");
    await expect(requirePageWorkspace()).rejects.toThrow(/^redirect:\/fr\/connexion$/);
  });
});

describe("platform administrator", () => {
  it("reads the role from the server session", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "synthetic-admin", role: "admin" } });
    expect(await isPlatformAdmin()).toBe(true);
    expect(await requireAdmin()).toEqual({ userId: "synthetic-admin" });
  });

  it("hides the console from workspace users", async () => {
    mocks.getSession.mockResolvedValue({ user: { id: "synthetic-user", role: "user" } });
    expect(await isPlatformAdmin()).toBe(false);
    await expect(requireAdmin()).rejects.toThrow("not-found");
  });

  it("is never an administrator without configured authentication", async () => {
    mocks.configured.mockReturnValue(false);
    expect(await isPlatformAdmin()).toBe(false);
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
