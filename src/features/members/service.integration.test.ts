import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ sendAuthEmail: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth-emails", () => ({ sendAuthEmail: dependencies.sendAuthEmail }));

import { databasePool, requireDb } from "@/db/runtime";
import {
  auditEvents,
  authInvitations,
  authMembers,
  authOrganizations,
  authUsers,
  workspaces,
} from "@/db/schema";
import {
  cancelWorkspaceMemberInvitation,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  workspaceMemberLimit,
} from "@/features/members/service";

const db = requireDb();
const pool = databasePool!;

async function cleanDatabase() {
  const result = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  const names = result.rows
    .map(({ tablename }) => tablename)
    .filter((name) => /^[a-z0-9_]+$/.test(name))
    .map((name) => `"${name}"`);
  if (names.length) await pool.query(`truncate table ${names.join(", ")} restart identity cascade`);
}

async function seedWorkspace() {
  const organizationId = randomUUID();
  const workspaceId = randomUUID();
  const ownerUserId = randomUUID();
  await db.insert(authUsers).values({
    id: ownerUserId,
    email: "owner@example.test",
    emailVerified: true,
    name: "Owner",
  });
  await db.insert(authOrganizations).values({ id: organizationId, name: "Acme", slug: `acme-${workspaceId.slice(0, 8)}` });
  await db.insert(workspaces).values({
    id: workspaceId,
    authOrganizationId: organizationId,
    authOwnerUserId: ownerUserId,
    name: "Acme",
    slug: `workspace-${workspaceId.slice(0, 8)}`,
    status: "approved",
    plan: "beta",
  });
  await db.insert(authMembers).values({ id: randomUUID(), organizationId, role: "owner", userId: ownerUserId });
  return { organizationId, ownerUserId, workspaceId };
}

beforeEach(async () => {
  await cleanDatabase();
  dependencies.sendAuthEmail.mockReset();
  dependencies.sendAuthEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  await cleanDatabase();
  await pool.end();
});

describe("workspace member lifecycle", () => {
  it("serializes concurrent invitations and reserves at most three seats", async () => {
    const context = await seedWorkspace();
    const attempts = ["one@example.test", "two@example.test", "three@example.test"].map((email) =>
      inviteWorkspaceMember({
        actorUserId: context.ownerUserId,
        db,
        email,
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
      }),
    );

    const results = await Promise.allSettled(attempts);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(workspaceMemberLimit - 1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(authInvitations)).toHaveLength(workspaceMemberLimit - 1);
    expect(dependencies.sendAuthEmail).toHaveBeenCalledTimes(workspaceMemberLimit - 1);
  });

  it("resends an existing invitation at capacity without consuming another seat", async () => {
    const context = await seedWorkspace();
    for (const email of ["one@example.test", "two@example.test"]) {
      await inviteWorkspaceMember({
        actorUserId: context.ownerUserId,
        db,
        email,
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
      });
    }

    const resent = await inviteWorkspaceMember({
      actorUserId: context.ownerUserId,
      db,
      email: "ONE@example.test",
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    });

    expect(resent.created).toBe(false);
    expect(await db.select().from(authInvitations)).toHaveLength(2);
    expect(dependencies.sendAuthEmail).toHaveBeenCalledTimes(3);
  });

  it("cancels a pending invitation and frees its reserved seat", async () => {
    const context = await seedWorkspace();
    const invitation = await inviteWorkspaceMember({
      actorUserId: context.ownerUserId,
      db,
      email: "member@example.test",
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    });
    await cancelWorkspaceMemberInvitation({
      actorUserId: context.ownerUserId,
      db,
      invitationId: invitation.id,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    });

    const [stored] = await db.select().from(authInvitations).where(eq(authInvitations.id, invitation.id));
    expect(stored.status).toBe("canceled");
    await expect(inviteWorkspaceMember({
      actorUserId: context.ownerUserId,
      db,
      email: "replacement@example.test",
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    })).resolves.toMatchObject({ created: true });
  });

  it("removes a regular member but never the owner or current actor", async () => {
    const context = await seedWorkspace();
    const memberUserId = randomUUID();
    const memberId = randomUUID();
    await db.insert(authUsers).values({ id: memberUserId, email: "member@example.test", emailVerified: true, name: "Member" });
    await db.insert(authMembers).values({ id: memberId, organizationId: context.organizationId, role: "member", userId: memberUserId });

    await removeWorkspaceMember({
      actorUserId: context.ownerUserId,
      db,
      memberId,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    });
    expect(await db.select().from(authMembers).where(eq(authMembers.id, memberId))).toHaveLength(0);
    const [owner] = await db.select().from(authMembers).where(eq(authMembers.userId, context.ownerUserId));
    await expect(removeWorkspaceMember({
      actorUserId: context.ownerUserId,
      db,
      memberId: owner.id,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    })).rejects.toThrow("vous retirer vous-même");
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "workspace.member_removed"))).toHaveLength(1);
  });
});
