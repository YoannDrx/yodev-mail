import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import {
  auditEvents,
  authInvitations,
  authMembers,
  authUsers,
  clientProvisioningRuns,
  workspaces,
} from "@/db/schema";

function includesOwner(role: string) {
  return role.split(",").some((value) => value.trim() === "owner");
}

export async function reconcileAcceptedOwnerInvitation(input: {
  invitationId: string;
  organizationId: string;
  userId: string;
  actorUserId: string;
}) {
  const db = requireDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select ${clientProvisioningRuns.id}
      from ${clientProvisioningRuns}
      where ${clientProvisioningRuns.invitationId} = ${input.invitationId}
      for update
    `);
    const [target] = await tx
      .select({
        currentOwnerUserId: workspaces.authOwnerUserId,
        invitationStatus: authInvitations.status,
        memberRole: authMembers.role,
        runId: clientProvisioningRuns.id,
        runStatus: clientProvisioningRuns.status,
        workspaceId: clientProvisioningRuns.workspaceId,
      })
      .from(clientProvisioningRuns)
      .innerJoin(
        authInvitations,
        and(
          eq(authInvitations.id, clientProvisioningRuns.invitationId),
          eq(authInvitations.organizationId, input.organizationId),
        ),
      )
      .innerJoin(
        workspaces,
        and(
          eq(workspaces.id, clientProvisioningRuns.workspaceId),
          eq(workspaces.authOrganizationId, input.organizationId),
        ),
      )
      .innerJoin(
        authMembers,
        and(
          eq(authMembers.organizationId, input.organizationId),
          eq(authMembers.userId, input.userId),
        ),
      )
      .where(eq(clientProvisioningRuns.invitationId, input.invitationId))
      .limit(1);

    if (!target) return { reconciled: false, skipped: true };
    if (target.invitationStatus !== "accepted" || !includesOwner(target.memberRole)) {
      throw new Error("The owner invitation is not fully accepted.");
    }
    if (target.currentOwnerUserId && target.currentOwnerUserId !== input.userId) {
      throw new Error("The workspace is already linked to another owner.");
    }

    const ownerChanged = target.currentOwnerUserId !== input.userId;
    if (ownerChanged) {
      const [updatedWorkspace] = await tx
        .update(workspaces)
        .set({ authOwnerUserId: input.userId, updatedAt: new Date() })
        .where(and(
          eq(workspaces.id, target.workspaceId),
          eq(workspaces.authOrganizationId, input.organizationId),
          or(
            isNull(workspaces.authOwnerUserId),
            eq(workspaces.authOwnerUserId, input.userId),
          ),
        ))
        .returning({ id: workspaces.id });
      if (!updatedWorkspace) {
        throw new Error("The workspace owner changed during reconciliation.");
      }
    }

    const [acceptedRun] = await tx
      .update(clientProvisioningRuns)
      .set({ status: "accepted", lastErrorCode: null, updatedAt: new Date() })
      .where(and(
        eq(clientProvisioningRuns.id, target.runId),
        eq(clientProvisioningRuns.workspaceId, target.workspaceId),
        ne(clientProvisioningRuns.status, "accepted"),
      ))
      .returning({ id: clientProvisioningRuns.id });

    if (acceptedRun || ownerChanged) {
      await tx.insert(auditEvents).values({
        workspaceId: target.workspaceId,
        actorUserId: input.actorUserId,
        action: acceptedRun
          ? "client.owner_invitation_accepted"
          : "client.owner_binding_reconciled",
        entityType: "auth_invitation",
        entityId: input.invitationId,
        metadata: { role: "owner", reconciliation: !acceptedRun },
      });
    }

    return {
      reconciled: Boolean(acceptedRun || ownerChanged),
      skipped: false,
      workspaceId: target.workspaceId,
    };
  });
}

async function acceptedOwnerCandidate(runId: string) {
  const [candidate] = await requireDb()
    .select({
      invitationId: authInvitations.id,
      organizationId: authInvitations.organizationId,
      role: authMembers.role,
      userId: authUsers.id,
    })
    .from(clientProvisioningRuns)
    .innerJoin(
      authInvitations,
      eq(authInvitations.id, clientProvisioningRuns.invitationId),
    )
    .innerJoin(
      authUsers,
      sql`lower(${authUsers.email}) = lower(${authInvitations.email})`,
    )
    .innerJoin(
      authMembers,
      and(
        eq(authMembers.organizationId, authInvitations.organizationId),
        eq(authMembers.userId, authUsers.id),
      ),
    )
    .where(and(
      eq(clientProvisioningRuns.id, runId),
      eq(authInvitations.status, "accepted"),
    ))
    .limit(1);
  return candidate && includesOwner(candidate.role) ? candidate : undefined;
}

export async function reconcileOwnerProvisioningRun(
  runId: string,
  actorUserId: string,
) {
  const candidate = await acceptedOwnerCandidate(runId);
  if (!candidate) {
    throw new Error("No accepted owner invitation is available for reconciliation.");
  }
  return reconcileAcceptedOwnerInvitation({
    invitationId: candidate.invitationId,
    organizationId: candidate.organizationId,
    userId: candidate.userId,
    actorUserId,
  });
}

export async function reconcilePendingOwnerInvitations(limit = 100) {
  const candidates = await requireDb()
    .select({ id: clientProvisioningRuns.id })
    .from(clientProvisioningRuns)
    .innerJoin(
      authInvitations,
      eq(authInvitations.id, clientProvisioningRuns.invitationId),
    )
    .where(and(
      ne(clientProvisioningRuns.status, "accepted"),
      eq(authInvitations.status, "accepted"),
    ))
    .limit(limit);

  let reconciled = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      const result = await reconcileOwnerProvisioningRun(
        candidate.id,
        "system:provisioning-reconciliation",
      );
      if (result.reconciled) reconciled += 1;
    } catch {
      failed += 1;
    }
  }
  return { failed, reconciled, scanned: candidates.length };
}
