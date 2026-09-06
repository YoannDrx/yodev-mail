import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentWorkspace: vi.fn(),
  getSession: vi.fn(),
  configured: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, notFound: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession: mocks.getSession } }) }));
vi.mock("@/lib/env", () => ({ isBetterAuthConfigured: mocks.configured }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/current-workspace", () => ({ currentWorkspace: mocks.currentWorkspace, WorkspaceAccessError: mocks.WorkspaceAccessError }));

import { requirePageWorkspace } from "./page-auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.configured.mockReturnValue(true);
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

  it("does not disguise a database outage as missing access", async () => {
    const failure = new Error("Database unavailable");
    mocks.currentWorkspace.mockRejectedValue(failure);
    await expect(requirePageWorkspace()).rejects.toBe(failure);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("requires a session before querying a workspace", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(requirePageWorkspace()).rejects.toThrow("redirect:/fr/connexion");
    expect(mocks.currentWorkspace).not.toHaveBeenCalled();
  });
});
