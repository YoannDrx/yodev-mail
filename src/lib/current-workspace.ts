import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { requireDb } from "@/db";
import {
  auditEvents,
  authMembers,
  authOrganizations,
  authSessions,
  authUsers,
  workspaces,
} from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { env } from "@/lib/env";

type AuthSession = {
  session: {
    id: string;
    activeOrganizationId?: string | null;
  };
  user: {
    id: string;
    email: string;
  };
};

async function bootstrapOwner(session: AuthSession) {
  if (session.user.email.toLowerCase() !== env.AUTH_BOOTSTRAP_EMAIL.toLowerCase()) {
    return null;
  }

  const db = requireDb();
  return db.transaction(async (tx) => {
    const [existingMembership] = await tx
      .select({ organizationId: authMembers.organizationId })
      .from(authMembers)
      .where(eq(authMembers.userId, session.user.id))
      .limit(1);
    if (existingMembership) return existingMembership.organizationId;

    const candidates = await tx
      .select({ id: workspaces.id, authOrganizationId: workspaces.authOrganizationId })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .limit(2);
    if (candidates.length !== 1) {
      throw new Error("The bootstrap workspace could not be identified unambiguously.");
    }

    let organizationId = candidates[0].authOrganizationId;
    if (!organizationId) {
      organizationId = randomUUID();
      await tx.insert(authOrganizations).values({
        id: organizationId,
        name: "Mail by Yodev",
        slug: "mail-by-yodev",
      });
      await tx
        .update(workspaces)
        .set({
          authOrganizationId: organizationId,
          authOwnerUserId: session.user.id,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaces.id, candidates[0].id),
            isNull(workspaces.authOrganizationId),
          ),
        );
    }

    await tx
      .insert(authMembers)
      .values({
        id: randomUUID(),
        organizationId,
        role: "owner",
        userId: session.user.id,
      })
      .onConflictDoNothing();
    await tx
      .update(authUsers)
      .set({ role: "admin", updatedAt: new Date() })
      .where(eq(authUsers.id, session.user.id));
    await tx.insert(auditEvents).values({
      action: "auth.better_auth_bootstrapped",
      actorUserId: session.user.id,
      entityId: organizationId,
      entityType: "auth_organization",
      metadata: {},
      workspaceId: candidates[0].id,
    });
    return organizationId;
  });
}

async function activeOrganization(session: AuthSession) {
  let organizationId = session.session.activeOrganizationId ?? null;
  if (!organizationId) {
    const [membership] = await requireDb()
      .select({ organizationId: authMembers.organizationId })
      .from(authMembers)
      .where(eq(authMembers.userId, session.user.id))
      .limit(1);
    organizationId = membership?.organizationId ?? (await bootstrapOwner(session));
  }
  if (organizationId && organizationId !== session.session.activeOrganizationId) {
    await requireDb()
      .update(authSessions)
      .set({ activeOrganizationId: organizationId, updatedAt: new Date() })
      .where(eq(authSessions.id, session.session.id));
  }
  return organizationId;
}

export async function currentWorkspace(options: { admin?: boolean } = {}) {
  const session = (await getAuth().api.getSession({
    headers: await headers(),
  })) as AuthSession | null;
  if (!session?.user.id) throw new Error("Authentication is required.");

  const organizationId = await activeOrganization(session);
  if (!organizationId) throw new Error("Sélectionnez une organisation Mail by Yodev.");

  const db = requireDb();
  const [membership] = await db
    .select({ role: authMembers.role })
    .from(authMembers)
    .where(
      and(
        eq(authMembers.organizationId, organizationId),
        eq(authMembers.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!membership) throw new Error("You are not a member of this workspace.");
  if (options.admin && !["owner", "admin"].includes(membership.role)) {
    throw new Error("Workspace administrator role required.");
  }

  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.authOrganizationId, organizationId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1);
  if (!workspace) throw new Error("Workspace has not been provisioned yet.");
  return {
    workspace,
    userId: session.user.id,
    orgId: organizationId,
    role: membership.role,
  };
}
