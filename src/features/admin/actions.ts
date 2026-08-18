"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  adminReviews,
  auditEvents,
  authInvitations,
  authOrganizations,
  clientProvisioningRuns,
  domainProviderBindings,
  domains,
  subscriptions,
  templates,
  transactionalProfiles,
  workspaceSettings,
  workspaceProviderAccounts,
  workspaces,
} from "@/db/schema";
import { enqueueProviderProvisioning } from "@/lib/aws";
import { sendAuthEmail } from "@/lib/auth-emails";
import { env, isFeatureEnabled } from "@/lib/env";
import { requireAdmin } from "@/lib/page-auth";
import { reconcileOwnerProvisioningRun } from "@/features/onboarding/reconcile-owner";
import { inviteWorkspaceMember } from "@/features/members/service";
import { provisionBinding } from "@/workers/provider-provisioning";

const idSchema = z.string().uuid();
const pilotDaysSchema = z.union([z.literal(30), z.literal(60), z.literal(90), z.null()]);
const clientWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(140),
  slug: z.string().trim().toLowerCase().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ownerEmail: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  websiteUrl: z.string().trim().url().max(2_048),
  useCase: z.string().trim().min(20).max(4_000),
  expectedMonthlyVolume: z.coerce.number().int().min(1).max(10_000_000),
});

function invitationUrl(invitationId: string) {
  const baseUrl = (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${baseUrl}/invitation?id=${encodeURIComponent(invitationId)}`;
}

async function deliverClientOwnerInvitation(runId: string, actorUserId: string) {
  const db = requireDb();
  const staleClaim = new Date(Date.now() - 5 * 60_000);
  const [claimed] = await db
    .update(clientProvisioningRuns)
    .set({
      status: "sending_email",
      attemptCount: sql`${clientProvisioningRuns.attemptCount} + 1`,
      lastErrorCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientProvisioningRuns.id, runId),
        or(
          inArray(clientProvisioningRuns.status, [
            "pending_email",
            "invitation_sent",
            "email_failed",
          ]),
          and(
            eq(clientProvisioningRuns.status, "sending_email"),
            lt(clientProvisioningRuns.updatedAt, staleClaim),
          ),
        ),
      ),
    )
    .returning({
      invitationId: clientProvisioningRuns.invitationId,
      workspaceId: clientProvisioningRuns.workspaceId,
    });
  if (!claimed) return;

  const [target] = await db
    .select({
      email: authInvitations.email,
      invitationStatus: authInvitations.status,
      organizationId: authInvitations.organizationId,
      organizationName: authOrganizations.name,
    })
    .from(authInvitations)
    .innerJoin(
      authOrganizations,
      eq(authOrganizations.id, authInvitations.organizationId),
    )
    .innerJoin(
      workspaces,
      eq(workspaces.authOrganizationId, authInvitations.organizationId),
    )
    .where(and(
      eq(authInvitations.id, claimed.invitationId),
      eq(workspaces.id, claimed.workspaceId),
    ))
    .limit(1);

  try {
    if (!target || target.invitationStatus !== "pending") {
      throw new Error("The owner invitation is no longer pending.");
    }
    await db
      .update(authInvitations)
      .set({ expiresAt: new Date(Date.now() + 48 * 60 * 60_000) })
      .where(
        and(
          eq(authInvitations.id, claimed.invitationId),
          eq(authInvitations.organizationId, target.organizationId),
          eq(authInvitations.status, "pending"),
        ),
      );
    await sendAuthEmail({
      actionUrl: invitationUrl(claimed.invitationId),
      intro: `Vous êtes invité à rejoindre ${target.organizationName}.`,
      kind: "organization_invitation",
      to: target.email,
    });
    await db.transaction(async (tx) => {
      await tx
        .update(clientProvisioningRuns)
        .set({
          status: "invitation_sent",
          emailSentAt: new Date(),
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(clientProvisioningRuns.id, runId),
          eq(clientProvisioningRuns.workspaceId, claimed.workspaceId),
        ));
      await tx.insert(auditEvents).values({
        workspaceId: claimed.workspaceId,
        actorUserId,
        action: "client.owner_invitation_sent",
        entityType: "auth_invitation",
        entityId: claimed.invitationId,
        metadata: { role: "owner" },
      });
    });
  } catch {
    await db.transaction(async (tx) => {
      await tx
        .update(clientProvisioningRuns)
        .set({
          status: "email_failed",
          lastErrorCode: "invitation_delivery_failed",
          updatedAt: new Date(),
        })
        .where(and(
          eq(clientProvisioningRuns.id, runId),
          eq(clientProvisioningRuns.workspaceId, claimed.workspaceId),
        ));
      await tx.insert(auditEvents).values({
        workspaceId: claimed.workspaceId,
        actorUserId,
        action: "client.owner_invitation_delivery_failed",
        entityType: "auth_invitation",
        entityId: claimed.invitationId,
        metadata: { errorCode: "invitation_delivery_failed" },
      });
    });
  }
}

export async function provisionClientWorkspaceAction(formData: FormData) {
  if (!isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED")) {
    throw new Error("Commercial onboarding is disabled.");
  }
  const input = clientWorkspaceSchema.parse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    ownerEmail: formData.get("ownerEmail"),
    websiteUrl: formData.get("websiteUrl"),
    useCase: formData.get("useCase"),
    expectedMonthlyVolume: formData.get("expectedMonthlyVolume"),
  });
  const { userId } = await requireAdmin();
  const organizationId = randomUUID();
  const invitationId = randomUUID();
  const db = requireDb();
  const [run] = await db.transaction(async (tx) => {
    const [existingWorkspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, input.slug))
      .limit(1);
    if (existingWorkspace) throw new Error("This workspace slug is already in use.");

    await tx.insert(authOrganizations).values({
      id: organizationId,
      name: input.name,
      slug: input.slug,
    });
    const [workspace] = await tx
      .insert(workspaces)
      .values({
        authOrganizationId: organizationId,
        contentPolicy: "template_only",
        dailyLimit: 50,
        expectedMonthlyVolume: input.expectedMonthlyVolume,
        name: input.name,
        plan: "sandbox",
        slug: input.slug,
        status: "sandbox",
        useCase: input.useCase,
        websiteUrl: input.websiteUrl,
      })
      .returning({ id: workspaces.id });
    await tx.insert(workspaceSettings).values({ workspaceId: workspace.id });
    await tx.insert(subscriptions).values({ workspaceId: workspace.id });
    await tx.insert(adminReviews).values({ workspaceId: workspace.id });
    await tx.insert(authInvitations).values({
      id: invitationId,
      organizationId,
      email: input.ownerEmail,
      role: "owner",
      status: "pending",
      expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
      inviterId: userId,
    });
    const [provisioningRun] = await tx
      .insert(clientProvisioningRuns)
      .values({ workspaceId: workspace.id, invitationId })
      .returning({ id: clientProvisioningRuns.id });
    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "client.workspace_provisioned",
      entityType: "workspace",
      entityId: workspace.id,
      metadata: { initialDailyLimit: 50, ownerRole: "owner" },
    });
    return [provisioningRun];
  });
  await deliverClientOwnerInvitation(run.id, userId);
  revalidatePath("/admin");
}

export async function retryClientOwnerInvitationAction(runId: string) {
  if (!isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED")) {
    throw new Error("Commercial onboarding is disabled.");
  }
  const id = idSchema.parse(runId);
  const { userId } = await requireAdmin();
  await deliverClientOwnerInvitation(id, userId);
  revalidatePath("/admin");
}

export async function reconcileClientOwnerAction(runId: string) {
  const id = idSchema.parse(runId);
  const { userId } = await requireAdmin();
  await reconcileOwnerProvisioningRun(id, userId);
  revalidatePath("/admin");
}

export async function inviteWorkspaceMemberAction(workspaceId: string, formData: FormData) {
  const id = idSchema.parse(workspaceId);
  const email = z.string().trim().email().parse(formData.get("email")).toLowerCase();
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [workspace] = await db.select({
    authOrganizationId: workspaces.authOrganizationId,
    status: workspaces.status,
  }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!workspace || workspace.status !== "approved" || !workspace.authOrganizationId) {
    throw new Error("An approved workspace linked to Better Auth is required");
  }
  await inviteWorkspaceMember({
    actorUserId: userId,
    db,
    email,
    organizationId: workspace.authOrganizationId,
    workspaceId: id,
  });
  revalidatePath("/admin");
}

export async function setPilotAccessAction(workspaceId: string, days: 30 | 60 | 90 | null) {
  const id = idSchema.parse(workspaceId);
  const durationDays = pilotDaysSchema.parse(days);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [workspace] = await db.select({ id: workspaces.id, status: workspaces.status }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!workspace || workspace.status !== "approved") throw new Error("Workspace must be approved before granting pilot access");
  const expiresAt = durationDays === null ? null : new Date(Date.now() + durationDays * 86_400_000);
  await db.transaction(async (tx) => {
    const updated = await tx.update(subscriptions).set({ pilotAccessExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, id)).returning({ id: subscriptions.id });
    if (!updated.length) throw new Error("Workspace subscription record is missing");
    await tx.insert(auditEvents).values({
      workspaceId: id,
      actorUserId: userId,
      action: durationDays === null ? "billing.pilot_access_revoked" : "billing.pilot_access_granted",
      entityType: "subscription",
      entityId: updated[0].id,
      metadata: { reason: "internal_canary", expiresAt: expiresAt?.toISOString() ?? null },
    });
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard/facturation");
}

export async function reviewWorkspaceAction(workspaceId: string, decision: "approved" | "rejected" | "limited") {
  const id = idSchema.parse(workspaceId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [current] = await db.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
  if (!current) throw new Error("Workspace not found");
  if (decision === "approved" && current.status !== "pending_review") {
    throw new Error("A completed onboarding review is required before approval.");
  }
  await db.transaction(async (tx) => {
    if (decision === "approved") {
      await tx.update(workspaces).set({ approvedAt: new Date(), dailyLimit: 50, pauseReason: null, pausedAt: null, status: "approved", warmupAdvancedAt: new Date(), warmupStage: 1, updatedAt: new Date() }).where(eq(workspaces.id, id));
      await tx.update(subscriptions).set({ plan: "beta", status: "inactive", graceEndsAt: null, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, id));
    } else if (decision === "rejected") {
      await tx.update(workspaces).set({ pauseReason: "admin_rejected", status: "rejected", updatedAt: new Date() }).where(eq(workspaces.id, id));
    } else {
      await tx.update(workspaces).set({ dailyLimit: 50, pauseReason: "admin_limited", pausedAt: new Date(), status: "paused", updatedAt: new Date() }).where(eq(workspaces.id, id));
    }
    const [review] = await tx.select().from(adminReviews).where(eq(adminReviews.workspaceId, id)).orderBy(adminReviews.createdAt).limit(1);
    if (review) await tx.update(adminReviews).set({ decision: decision === "limited" ? "pending" : decision, reviewedAt: new Date(), reviewedBy: userId, updatedAt: new Date() }).where(and(eq(adminReviews.id, review.id), eq(adminReviews.workspaceId, id)));
    await tx.insert(auditEvents).values({ action: `workspace.${decision}`, actorUserId: userId, entityId: id, entityType: "workspace", workspaceId: id, metadata: { initialDailyLimit: 50 } });
  });
  revalidatePath("/admin");
}

export async function setWorkspaceContentPolicyAction(workspaceId: string, policy: "template_only" | "hybrid") {
  const id = idSchema.parse(workspaceId);
  const { userId } = await requireAdmin();
  await requireDb().transaction(async (tx) => {
    await tx.update(workspaces).set({ contentPolicy: policy, updatedAt: new Date() }).where(eq(workspaces.id, id));
    await tx.insert(auditEvents).values({ workspaceId: id, actorUserId: userId, action: "workspace.content_policy_changed", entityType: "workspace", entityId: id, metadata: { policy } });
  });
  revalidatePath("/admin");
}

export async function reviewTransactionalProfileAction(profileId: string, decision: "approved" | "rejected") {
  const id = idSchema.parse(profileId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [profile] = await db.select().from(transactionalProfiles).where(eq(transactionalProfiles.id, id)).limit(1);
  if (!profile) throw new Error("Profile not found");
  await db.transaction(async (tx) => {
    await tx.update(transactionalProfiles).set({ status: decision, approvedAt: decision === "approved" ? new Date() : null, approvedBy: decision === "approved" ? userId : null, updatedAt: new Date() }).where(and(eq(transactionalProfiles.id, id), eq(transactionalProfiles.workspaceId, profile.workspaceId)));
    await tx.insert(auditEvents).values({ workspaceId: profile.workspaceId, actorUserId: userId, action: `transactional_profile.${decision}`, entityType: "transactional_profile", entityId: id });
  });
  revalidatePath("/admin");
}

export async function reviewTemplateAction(templateId: string, decision: "approved" | "rejected") {
  const id = idSchema.parse(templateId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [template] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  if (!template) throw new Error("Template not found");
  await db.transaction(async (tx) => {
    await tx.update(templates).set({ reviewStatus: decision, approvedAt: decision === "approved" ? new Date() : null, approvedBy: decision === "approved" ? userId : null, updatedAt: new Date() }).where(and(eq(templates.id, id), eq(templates.workspaceId, template.workspaceId)));
    await tx.insert(auditEvents).values({ workspaceId: template.workspaceId, actorUserId: userId, action: `template.${decision}`, entityType: "template", entityId: id });
  });
  revalidatePath("/admin");
}

export async function provisionDomainAction(domainId: string, provider: "postmark" | "ses") {
  const id = idSchema.parse(domainId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
  if (!domain) throw new Error("Domain not found");
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, domain.workspaceId)).limit(1);
  if (!workspace || workspace.status !== "approved") throw new Error("Workspace must be approved first");
  if (provider === "ses" && process.env.SES_ENABLED !== "true") throw new Error("SES is disabled until AWS production approval");
  if (provider === "postmark" && process.env.POSTMARK_ENABLED !== "true") throw new Error("Postmark is not enabled");
  const [binding] = await db.insert(domainProviderBindings).values({ workspaceId: workspace.id, domainId: domain.id, provider, status: "pending" }).onConflictDoUpdate({
    target: [domainProviderBindings.domainId, domainProviderBindings.provider],
    set: { status: "pending", lastCheckError: null, updatedAt: new Date() },
  }).returning();
  await db.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "domain.provider_provisioning_requested", entityType: "domain", entityId: domain.id, metadata: { provider } });
  const queued = await enqueueProviderProvisioning(binding.id);
  if (queued.local) await provisionBinding(binding.id);
  revalidatePath("/admin");
  revalidatePath("/dashboard/domaines");
}

export async function activateDomainBindingAction(bindingId: string) {
  const id = idSchema.parse(bindingId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [binding] = await db.select().from(domainProviderBindings).where(eq(domainProviderBindings.id, id)).limit(1);
  if (!binding || binding.status !== "verified") throw new Error("Binding must be verified first");
  await db.transaction(async (tx) => {
    await tx.update(domainProviderBindings).set({ isActive: false, updatedAt: new Date() }).where(and(
      eq(domainProviderBindings.domainId, binding.domainId),
      eq(domainProviderBindings.workspaceId, binding.workspaceId),
    ));
    await tx.update(domainProviderBindings).set({ isActive: true, updatedAt: new Date() }).where(and(
      eq(domainProviderBindings.id, id),
      eq(domainProviderBindings.workspaceId, binding.workspaceId),
    ));
    await tx.update(domains).set({ activeProvider: binding.provider, status: "verified", updatedAt: new Date() }).where(and(eq(domains.id, binding.domainId), eq(domains.workspaceId, binding.workspaceId)));
    await tx.update(workspaces).set({ defaultProvider: binding.provider, updatedAt: new Date() }).where(eq(workspaces.id, binding.workspaceId));
    await tx.insert(auditEvents).values({ workspaceId: binding.workspaceId, actorUserId: userId, action: "domain.provider_activated", entityType: "domain_binding", entityId: id, metadata: { provider: binding.provider } });
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard/domaines");
}

export async function setProviderAccountStatusAction(accountId: string, status: "ready" | "paused" | "disabled") {
  const id = idSchema.parse(accountId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [account] = await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.id, id)).limit(1);
  if (!account) throw new Error("Provider account not found");
  if (status === "ready" && !account.externalAccountId) throw new Error("The provider account is not provisioned");
  await db.transaction(async (tx) => {
    await tx.update(workspaceProviderAccounts).set({
      status,
      pausedAt: status === "paused" ? new Date() : null,
      pauseReason: status === "paused" ? "admin_pause" : status === "disabled" ? "admin_disabled" : null,
      updatedAt: new Date(),
    }).where(and(eq(workspaceProviderAccounts.id, id), eq(workspaceProviderAccounts.workspaceId, account.workspaceId)));
    await tx.insert(auditEvents).values({ workspaceId: account.workspaceId, actorUserId: userId, action: `provider_account.${status}`, entityType: "provider_account", entityId: id, metadata: { provider: account.provider } });
  });
  revalidatePath("/admin");
}

export async function disableDomainBindingAction(bindingId: string) {
  const id = idSchema.parse(bindingId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [binding] = await db.select().from(domainProviderBindings).where(eq(domainProviderBindings.id, id)).limit(1);
  if (!binding) throw new Error("Binding not found");
  await db.transaction(async (tx) => {
    await tx.update(domainProviderBindings).set({ isActive: false, status: "disabled", updatedAt: new Date() }).where(and(eq(domainProviderBindings.id, id), eq(domainProviderBindings.workspaceId, binding.workspaceId)));
    if (binding.isActive) {
      await tx.update(domains).set({ activeProvider: null, status: "disabled", updatedAt: new Date() }).where(and(eq(domains.id, binding.domainId), eq(domains.workspaceId, binding.workspaceId)));
    }
    await tx.insert(auditEvents).values({ workspaceId: binding.workspaceId, actorUserId: userId, action: "domain.provider_disabled", entityType: "domain_binding", entityId: id, metadata: { provider: binding.provider } });
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard/domaines");
}

export async function disableTransactionalProfileAction(profileId: string) {
  const id = idSchema.parse(profileId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [profile] = await db.select().from(transactionalProfiles).where(eq(transactionalProfiles.id, id)).limit(1);
  if (!profile) throw new Error("Profile not found");
  await db.transaction(async (tx) => {
    await tx.update(transactionalProfiles).set({ status: "disabled", updatedAt: new Date() }).where(and(eq(transactionalProfiles.id, id), eq(transactionalProfiles.workspaceId, profile.workspaceId)));
    await tx.insert(auditEvents).values({ workspaceId: profile.workspaceId, actorUserId: userId, action: "transactional_profile.disabled_by_admin", entityType: "transactional_profile", entityId: id });
  });
  revalidatePath("/admin");
}

export async function disableTemplateAction(templateId: string) {
  const id = idSchema.parse(templateId);
  const { userId } = await requireAdmin();
  const db = requireDb();
  const [template] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  if (!template) throw new Error("Template not found");
  await db.transaction(async (tx) => {
    await tx.update(templates).set({ reviewStatus: "disabled", updatedAt: new Date() }).where(and(eq(templates.id, id), eq(templates.workspaceId, template.workspaceId)));
    await tx.insert(auditEvents).values({ workspaceId: template.workspaceId, actorUserId: userId, action: "template.disabled_by_admin", entityType: "template", entityId: id });
  });
  revalidatePath("/admin");
}
