import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => {
  class WorkspaceAccessError extends Error {}
  return { currentWorkspace: vi.fn(), WorkspaceAccessError };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "fr" }));
vi.mock("@/lib/current-workspace", () => session);

import { databasePool, requireDb } from "@/db/runtime";
import {
  auditEvents,
  authInvitations,
  authMembers,
  authOrganizations,
  authUsers,
  workspaces,
} from "@/db/schema";
import { initialActionState } from "@/lib/action-state";
import {
  cancelMemberInvitationAction,
  copyMemberInvitationLinkAction,
  inviteMemberAction,
  removeMemberAction,
  type MemberActionState,
} from "./actions";
import { copiedInvitationLinkTtlMs } from "./invitation-link";

const db = requireDb();
const pool = databasePool!;
const initial = initialActionState() as MemberActionState;

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  const names = result.rows.map(({ tablename }) => tablename).filter((name) => /^[a-z0-9_]+$/.test(name)).map((name) => `"${name}"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function seedWorkspace(status: "approved" | "pending_review" = "approved") {
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const ownerUserId = randomUUID();
  await db.insert(authUsers).values({ id: ownerUserId, email: `owner-${ownerUserId}@example.test`, emailVerified: true, name: "Owner" });
  await db.insert(authOrganizations).values({ id: organizationId, name: "Acme", slug: organizationId });
  await db.insert(workspaces).values({ id: workspaceId, authOrganizationId: organizationId, authOwnerUserId: ownerUserId, name: "Acme", slug: workspaceId, status, plan: "beta" });
  await db.insert(authMembers).values({ id: randomUUID(), organizationId, role: "owner", userId: ownerUserId });
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  return { organizationId, ownerUserId, workspace };
}

function actAs(context: Awaited<ReturnType<typeof seedWorkspace>>) {
  session.currentWorkspace.mockResolvedValue({ workspace: context.workspace, userId: context.ownerUserId, orgId: context.organizationId, role: "owner" });
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(async () => {
  await cleanDatabase();
  session.currentWorkspace.mockReset();
  vi.stubEnv("POSTMARK_ENABLED", "false");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanDatabase();
  await pool.end();
});

describe("member invitations while system email is off", () => {
  it("records the invitation and hands an audited 24-hour link to the owner", async () => {
    const context = await seedWorkspace();
    actAs(context);
    const before = Date.now();
    const state = await inviteMemberAction(initial, form({ email: " New.Member@Example.test " }));

    expect(state.ok).toBe(true);
    expect(state.message).toContain("l’email n’a pas pu être envoyé");
    const [invitation] = await db.select().from(authInvitations).where(eq(authInvitations.organizationId, context.organizationId));
    expect(invitation).toMatchObject({ email: "new.member@example.test", status: "pending" });
    expect(state.data?.link?.url).toBe(`http://localhost:3000/fr/invitation?id=${invitation.id}`);
    const lifetime = invitation.expiresAt.getTime() - before;
    expect(lifetime).toBeGreaterThan(copiedInvitationLinkTtlMs - 60_000);
    expect(lifetime).toBeLessThanOrEqual(copiedInvitationLinkTtlMs + 60_000);

    const audits = await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, context.workspace.id));
    expect(audits.map((event) => event.action).sort()).toEqual([
      "workspace.invitation_link_copied",
      "workspace.member_invitation_created",
      "workspace.member_invitation_delivery_failed",
    ]);
    const copied = audits.find((event) => event.action === "workspace.invitation_link_copied")!;
    expect(copied).toMatchObject({ actorUserId: context.ownerUserId, entityId: invitation.id, entityType: "auth_invitation" });
    expect(copied.metadata).toMatchObject({ role: "member", issuedBy: "workspace_admin" });
    // Neither the address nor the bearer link is ever written to the audit trail.
    const serialized = JSON.stringify(audits);
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("/invitation?id=");
  });

  it("issues a fresh link on demand for a pending invitation of the same workspace only", async () => {
    const context = await seedWorkspace();
    const other = await seedWorkspace();
    actAs(other);
    await inviteMemberAction(initial, form({ email: "foreign@example.test" }));
    const [foreign] = await db.select().from(authInvitations).where(eq(authInvitations.organizationId, other.organizationId));

    actAs(context);
    const refused = await copyMemberInvitationLinkAction(initial, form({ invitationId: foreign.id }));
    expect(refused).toMatchObject({ ok: false, message: "Invitation introuvable ou déjà traitée." });
    expect(await db.select().from(auditEvents).where(and(
      eq(auditEvents.workspaceId, context.workspace.id),
      eq(auditEvents.action, "workspace.invitation_link_copied"),
    ))).toHaveLength(0);

    await inviteMemberAction(initial, form({ email: "own@example.test" }));
    const [own] = await db.select().from(authInvitations).where(eq(authInvitations.organizationId, context.organizationId));
    const issued = await copyMemberInvitationLinkAction(initial, form({ invitationId: own.id }));
    expect(issued.ok).toBe(true);
    expect(issued.data?.link?.url).toContain(own.id);

    const revoked = await cancelMemberInvitationAction(initial, form({ invitationId: own.id }));
    expect(revoked).toMatchObject({ ok: true, message: "Invitation révoquée." });
    expect(await copyMemberInvitationLinkAction(initial, form({ invitationId: own.id }))).toMatchObject({ ok: false });
  });
});

describe("member form results", () => {
  it("keeps the typed value and reports a field error for an invalid address", async () => {
    const context = await seedWorkspace();
    actAs(context);
    const state = await inviteMemberAction(initial, form({ email: "not-an-address" }));
    expect(state).toMatchObject({ ok: false, values: { email: "not-an-address" } });
    expect(state.fieldErrors.email).toEqual(["Indiquez une adresse email valide."]);
    expect(await db.select().from(authInvitations)).toHaveLength(0);
  });

  it("explains that invitations wait for workspace approval", async () => {
    const context = await seedWorkspace("pending_review");
    actAs(context);
    const state = await inviteMemberAction(initial, form({ email: "member@example.test" }));
    expect(state).toMatchObject({ ok: false, message: "Le workspace doit être approuvé par Yodev avant d’inviter un membre.", values: { email: "member@example.test" } });
    expect(await db.select().from(authInvitations)).toHaveLength(0);
  });

  it("explains the role requirement to a plain member", async () => {
    session.currentWorkspace.mockRejectedValue(new Error("Workspace administrator role required."));
    const state = await removeMemberAction(initial, form({ memberId: randomUUID() }));
    expect(state).toMatchObject({ ok: false, message: "Seuls le propriétaire et les administrateurs du workspace peuvent gérer les membres." });
  });

  it("confirms a removal and refuses to remove the owner", async () => {
    const context = await seedWorkspace();
    actAs(context);
    const memberUserId = randomUUID();
    const memberId = randomUUID();
    await db.insert(authUsers).values({ id: memberUserId, email: "member@example.test", emailVerified: true, name: "Member" });
    await db.insert(authMembers).values({ id: memberId, organizationId: context.organizationId, role: "member", userId: memberUserId });
    expect(await removeMemberAction(initial, form({ memberId }))).toMatchObject({ ok: true, message: "Membre retiré du workspace." });
    const [owner] = await db.select().from(authMembers).where(eq(authMembers.userId, context.ownerUserId));
    expect(await removeMemberAction(initial, form({ memberId: owner.id }))).toMatchObject({ ok: false, message: "Vous ne pouvez pas vous retirer vous-même du workspace." });
  });

  it("lets unexpected failures reach the error boundary", async () => {
    session.currentWorkspace.mockRejectedValue(new Error("Database unavailable"));
    await expect(removeMemberAction(initial, form({ memberId: randomUUID() }))).rejects.toThrow("Database unavailable");
  });
});
