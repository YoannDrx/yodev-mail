import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db";
import { purgeDeletedWorkspace } from "@/features/workspace-data/purge";
import {
  apiKeys,
  auditEvents,
  authMembers,
  authOrganizations,
  authSessions,
  authUsers,
  domains,
  messages,
  sesResources,
  stripeUsageReportJobs,
  stripeUsageReports,
  subscriptions,
  webhookEndpoints,
  workspaceProviderAccounts,
  workspaces,
} from "@/db/schema";

export type WorkspaceDeletionRefusal =
  | "not_found"
  | "not_owner"
  | "confirmation_mismatch"
  | "subscription_active"
  | "messages_in_flight"
  | "usage_unreported";

export type WorkspaceDeletionResult =
  | { status: "refused"; reason: WorkspaceDeletionRefusal }
  | { status: "deleted"; purged: boolean };

const blockingSubscriptionStatuses = ["trialing", "active", "past_due"] as const;
const unreportedUsageStatuses = ["pending", "processing", "failed"] as const;

/**
 * Owner deletion of a workspace. In one transaction: checks, then every way
 * in is closed (API keys revoked, webhooks disabled, the Better Auth
 * organization deleted, which removes memberships and invitations and clears
 * it from every session). The data is then purged in bounded batches; the
 * retention worker finishes a purge that does not fit in this request.
 *
 * Refused while a paid subscription is still running (cancel it from the
 * billing portal first), while messages are queued or sending, or while
 * accepted usage has not been reported to Stripe yet.
 */
export async function requestWorkspaceDeletion(input: {
  workspaceId: string;
  organizationId: string;
  actorUserId: string;
  confirmationName: string;
  now?: Date;
}): Promise<WorkspaceDeletionResult> {
  z.uuid().parse(input.workspaceId);
  const now = input.now ?? new Date();
  const db = requireDb();
  const outcome = await db.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: workspaces.id, name: workspaces.name, sesTenantName: workspaces.sesTenantName })
      .from(workspaces)
      .where(and(
        eq(workspaces.id, input.workspaceId),
        eq(workspaces.authOrganizationId, input.organizationId),
        isNull(workspaces.deletedAt),
      ))
      .for("update")
      .limit(1);
    if (!workspace) return { status: "refused", reason: "not_found" } as const;
    const [membership] = await tx
      .select({ role: authMembers.role })
      .from(authMembers)
      .where(and(eq(authMembers.organizationId, input.organizationId), eq(authMembers.userId, input.actorUserId)))
      .limit(1);
    if (!membership?.role.split(",").map((role) => role.trim()).includes("owner")) {
      return { status: "refused", reason: "not_owner" } as const;
    }
    if (input.confirmationName.trim() !== workspace.name.trim()) {
      return { status: "refused", reason: "confirmation_mismatch" } as const;
    }
    const [subscription] = await tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(and(
        eq(subscriptions.workspaceId, workspace.id),
        inArray(subscriptions.status, [...blockingSubscriptionStatuses]),
      ))
      .limit(1);
    if (subscription) return { status: "refused", reason: "subscription_active" } as const;
    const [inFlight] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.workspaceId, workspace.id), inArray(messages.status, ["queued", "sending"])))
      .limit(1);
    if (inFlight) return { status: "refused", reason: "messages_in_flight" } as const;
    const [unreportedJob] = await tx
      .select({ id: stripeUsageReportJobs.id })
      .from(stripeUsageReportJobs)
      .where(and(
        eq(stripeUsageReportJobs.workspaceId, workspace.id),
        inArray(stripeUsageReportJobs.status, [...unreportedUsageStatuses]),
      ))
      .limit(1);
    const [unreportedReport] = await tx
      .select({ id: stripeUsageReports.id })
      .from(stripeUsageReports)
      .where(and(
        eq(stripeUsageReports.workspaceId, workspace.id),
        inArray(stripeUsageReports.status, [...unreportedUsageStatuses]),
      ))
      .limit(1);
    if (unreportedJob || unreportedReport) return { status: "refused", reason: "usage_unreported" } as const;

    // Provider resources (Postmark servers, SES identities and tenants) are not
    // deleted here: their identifiers go to the platform audit trail so an
    // operator can remove them. They are identifiers, not credentials.
    const providerAccounts = await tx
      .select({
        provider: workspaceProviderAccounts.provider,
        externalAccountId: workspaceProviderAccounts.externalAccountId,
        credentialParameterName: workspaceProviderAccounts.credentialParameterName,
      })
      .from(workspaceProviderAccounts)
      .where(eq(workspaceProviderAccounts.workspaceId, workspace.id));
    const ses = await tx
      .select({ resourceType: sesResources.resourceType, resourceName: sesResources.resourceName, resourceArn: sesResources.resourceArn })
      .from(sesResources)
      .where(eq(sesResources.workspaceId, workspace.id));
    const domainNames = await tx
      .select({ name: domains.name })
      .from(domains)
      .where(eq(domains.workspaceId, workspace.id));

    await tx
      .update(apiKeys)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(apiKeys.workspaceId, workspace.id), isNull(apiKeys.revokedAt)));
    await tx
      .update(webhookEndpoints)
      .set({ enabled: false, updatedAt: now })
      .where(eq(webhookEndpoints.workspaceId, workspace.id));
    await tx
      .update(workspaces)
      .set({
        deletedAt: now,
        purgeRequestedAt: now,
        status: "paused",
        pausedAt: now,
        pauseReason: "workspace_deleted",
        authOrganizationId: null,
        updatedAt: now,
      })
      .where(eq(workspaces.id, workspace.id));
    await tx
      .update(authSessions)
      .set({ activeOrganizationId: null, updatedAt: now })
      .where(eq(authSessions.activeOrganizationId, input.organizationId));
    // Cascades to memberships and invitations.
    await tx.delete(authOrganizations).where(eq(authOrganizations.id, input.organizationId));
    await tx.insert(auditEvents).values({
      workspaceId: null,
      actorUserId: input.actorUserId,
      action: "workspace.deleted",
      entityType: "workspace",
      entityId: workspace.id,
      metadata: {
        providerCleanup: {
          sesTenantName: workspace.sesTenantName,
          providerAccounts,
          sesResources: ses,
          domains: domainNames.map((domain) => domain.name),
        },
      },
      createdAt: now,
    });
    return { status: "accepted" } as const;
  });
  if (outcome.status === "refused") return outcome;
  const { done } = await purgeDeletedWorkspace(input.workspaceId, { budgetMs: 15_000 });
  return { status: "deleted", purged: done };
}

export type AccountDeletionRefusal = "not_found" | "confirmation_mismatch" | "owns_workspace" | "platform_admin";

/**
 * Self-service deletion of the signed-in user's account. Refused while the
 * user owns a workspace (delete it or hand it over first) and for platform
 * administrators. Deleting the user removes sessions, linked sign-in
 * methods, passkeys and memberships; invitations they sent keep no inviter.
 * Audit events keep only the opaque user id.
 */
export async function deleteUserAccount(input: {
  userId: string;
  /** The typed account email; null only when the caller already obtained an explicit confirmation. */
  confirmationEmail: string | null;
  now?: Date;
}): Promise<
  { status: "refused"; reason: AccountDeletionRefusal } | { status: "deleted" }
> {
  const now = input.now ?? new Date();
  return requireDb().transaction(async (tx) => {
    const [user] = await tx
      .select({ id: authUsers.id, email: authUsers.email, role: authUsers.role })
      .from(authUsers)
      .where(eq(authUsers.id, input.userId))
      .for("update")
      .limit(1);
    if (!user) return { status: "refused", reason: "not_found" } as const;
    if (input.confirmationEmail !== null && input.confirmationEmail.trim().toLowerCase() !== user.email.trim().toLowerCase()) {
      return { status: "refused", reason: "confirmation_mismatch" } as const;
    }
    if (user.role.split(",").map((role) => role.trim()).includes("admin")) {
      return { status: "refused", reason: "platform_admin" } as const;
    }
    const memberships = await tx
      .select({ role: authMembers.role })
      .from(authMembers)
      .where(eq(authMembers.userId, user.id));
    if (memberships.some((membership) => membership.role.split(",").map((role) => role.trim()).includes("owner"))) {
      return { status: "refused", reason: "owns_workspace" } as const;
    }
    const [ownedWorkspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.authOwnerUserId, user.id), isNull(workspaces.deletedAt)))
      .limit(1);
    if (ownedWorkspace) return { status: "refused", reason: "owns_workspace" } as const;
    await tx.delete(authUsers).where(eq(authUsers.id, user.id));
    await tx.insert(auditEvents).values({
      workspaceId: null,
      actorUserId: user.id,
      action: "account.deleted",
      entityType: "user",
      entityId: user.id,
      metadata: {},
      createdAt: now,
    });
    return { status: "deleted" } as const;
  });
}
