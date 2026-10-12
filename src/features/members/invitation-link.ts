import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import { auditEvents, authInvitations, workspaces } from "@/db/schema";
import { env } from "@/lib/env";

type Database = ReturnType<typeof requireDb>;

/**
 * A link handed over by hand (chat, phone) is shorter-lived than the 48 h
 * emailed invitation: copying it resets the invitation to expire in 24 h.
 */
export const copiedInvitationLinkTtlMs = 24 * 60 * 60_000;

export function invitationUrl(invitationId: string) {
  const baseUrl = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/fr/invitation?id=${encodeURIComponent(invitationId)}`;
}

export class InvitationLinkUnavailableError extends Error {
  constructor() {
    super("Invitation introuvable ou déjà traitée.");
    this.name = "InvitationLinkUnavailableError";
  }
}

/**
 * Returns the acceptance link of a pending invitation of this workspace so it
 * can be shared without the system email (Postmark off or delivery failure).
 * Every issue is audited; neither the link nor the address is ever stored in
 * the audit metadata or logged.
 */
export async function issueInvitationLink(input: {
  actorUserId: string;
  db: Database;
  invitationId: string;
  organizationId: string;
  workspaceId: string;
  issuedBy: "platform_admin" | "workspace_admin";
}) {
  const expiresAt = new Date(Date.now() + copiedInvitationLinkTtlMs);
  return input.db.transaction(async (tx) => {
    const [invitation] = await tx
      .update(authInvitations)
      .set({ expiresAt })
      .where(and(
        eq(authInvitations.id, input.invitationId),
        eq(authInvitations.organizationId, input.organizationId),
        eq(authInvitations.status, "pending"),
        sql`exists(select 1 from ${workspaces} where ${workspaces.id} = ${input.workspaceId} and ${workspaces.authOrganizationId} = ${input.organizationId} and ${workspaces.deletedAt} is null)`,
      ))
      .returning({ id: authInvitations.id, role: authInvitations.role });
    if (!invitation) throw new InvitationLinkUnavailableError();
    await tx.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "workspace.invitation_link_copied",
      entityType: "auth_invitation",
      entityId: invitation.id,
      metadata: { role: invitation.role, issuedBy: input.issuedBy, expiresAt: expiresAt.toISOString() },
    });
    return { url: invitationUrl(invitation.id), expiresAt };
  });
}
