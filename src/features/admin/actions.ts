"use server";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
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
import {
  actionFailure,
  actionSuccess,
  fieldErrorsFromZod,
  formValues,
  type ActionState,
} from "@/lib/action-state";
import { isFeatureEnabled } from "@/lib/env";
import { requireAdmin } from "@/lib/page-auth";
import { reconcileOwnerProvisioningRun } from "@/features/onboarding/reconcile-owner";
import {
  InvitationLinkUnavailableError,
  invitationUrl,
  issueInvitationLink,
} from "@/features/members/invitation-link";
import { inviteWorkspaceMember, MemberServiceError } from "@/features/members/service";
import { provisionBinding } from "@/workers/provider-provisioning";
import { POSTMARK_WEBHOOK_CREATE_UNCERTAIN } from "@/features/providers/provision-postmark";
import { localized, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export type AdminActionState = ActionState<{ link?: { url: string; expiresAt: string } }>;

const idSchema = z.string().uuid();
const pilotDaysSchema = z.union([z.literal(30), z.literal(60), z.literal(90), z.null()]);
const workspaceDecisionSchema = z.enum(["approved", "rejected", "limited"]);
const reviewDecisionSchema = z.enum(["approved", "rejected"]);
const contentPolicySchema = z.enum(["template_only", "hybrid"]);
const providerSchema = z.enum(["postmark", "ses"]);
const providerAccountStatusSchema = z.enum(["ready", "paused", "disabled"]);
const clientWorkspaceSchema = z.object({
  name: z.string().trim().min(2).max(140),
  slug: z.string().trim().toLowerCase().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ownerEmail: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
  websiteUrl: z.string().trim().url().max(2_048),
  useCase: z.string().trim().min(20).max(4_000),
  expectedMonthlyVolume: z.coerce.number().int().min(1).max(10_000_000),
});
const clientFields = ["name", "slug", "ownerEmail", "websiteUrl", "useCase", "expectedMonthlyVolume"] as const;

/** An expected refusal shown next to the button instead of the error screen. */
class AdminRefusal extends Error {
  constructor(readonly copy: Record<Locale, string>) {
    super(copy.en);
    this.name = "AdminRefusal";
  }
}

const refusals = {
  gateClosed: { fr: "L’onboarding commercial est fermé (COMMERCIAL_ONBOARDING_ENABLED).", en: "Commercial onboarding is closed (COMMERCIAL_ONBOARDING_ENABLED)." },
  invalid: { fr: "Paramètres de l’action invalides.", en: "Invalid action parameters." },
  workspaceNotFound: { fr: "Workspace introuvable.", en: "Workspace not found." },
  notReviewed: { fr: "Le dossier d’onboarding doit être complété avant l’approbation.", en: "A completed onboarding review is required before approval." },
  notApproved: { fr: "Le workspace doit être approuvé et relié à Better Auth.", en: "The workspace must be approved and linked to Better Auth." },
  subscriptionMissing: { fr: "L’abonnement du workspace est introuvable.", en: "The workspace subscription record is missing." },
  profileNotFound: { fr: "Cas d’usage introuvable.", en: "Use case not found." },
  templateNotFound: { fr: "Template introuvable.", en: "Template not found." },
  domainNotFound: { fr: "Domaine introuvable.", en: "Domain not found." },
  domainUnavailable: { fr: "Le workspace et le domaine doivent être disponibles pour le provisionnement.", en: "Workspace and domain must be available for provisioning." },
  sesDisabled: { fr: "SES reste désactivé jusqu’à l’approbation AWS de production.", en: "SES is disabled until AWS production approval." },
  postmarkDisabled: { fr: "Postmark n’est pas activé.", en: "Postmark is not enabled." },
  bindingLocked: { fr: "Liaison déjà provisionnée ou désactivée : elle ne peut pas être réinitialisée par une nouvelle tentative.", en: "Binding already provisioned or disabled; it cannot be reset by a provisioning retry." },
  bindingNotFound: { fr: "Liaison fournisseur introuvable.", en: "Provider binding not found." },
  bindingNotVerified: { fr: "La liaison doit d’abord être vérifiée.", en: "The binding must be verified first." },
  accountNotFound: { fr: "Compte fournisseur introuvable.", en: "Provider account not found." },
  accountNotProvisioned: { fr: "Le compte fournisseur n’est pas provisionné.", en: "The provider account is not provisioned." },
  runNotFound: { fr: "Provisionnement introuvable.", en: "Provisioning run not found." },
  slugTaken: { fr: "Ce slug est déjà utilisé.", en: "This workspace slug is already in use." },
  invitationUnavailable: { fr: "Aucune invitation en attente pour ce provisionnement.", en: "No pending invitation for this provisioning run." },
  noAcceptedOwner: { fr: "Aucune invitation propriétaire acceptée à réconcilier.", en: "No accepted owner invitation is available for reconciliation." },
} satisfies Record<string, Record<Locale, string>>;

const done = { fr: "Action enregistrée.", en: "Action recorded." };

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AdminRefusal(refusals.invalid);
  return result.data;
}

// Runs an admin action and turns expected refusals into a structured result.
// Framework redirects (session lost, not an admin) and unexpected failures
// keep their normal behaviour.
async function run(
  action: (locale: Locale) => Promise<AdminActionState | Record<Locale, string>>,
  values: Record<string, string> = {},
): Promise<AdminActionState> {
  const locale = await getLocale();
  try {
    const result = await action(locale);
    return "ok" in result ? result : actionSuccess(result[locale]);
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AdminRefusal) return actionFailure(error.copy[locale], { values });
    if (error instanceof InvitationLinkUnavailableError) return actionFailure(refusals.invitationUnavailable[locale], { values });
    if (error instanceof MemberServiceError) return actionFailure(error.message, { values });
    throw error;
  }
}

function linkResult(locale: Locale, message: Record<Locale, string>, link: { url: string; expiresAt: Date }): AdminActionState {
  return actionSuccess(message[locale], { link: { url: link.url, expiresAt: link.expiresAt.toISOString() } });
}

const emailFailedCopy = {
  fr: "L’email d’invitation n’a pas pu être envoyé. Copiez le lien ci-dessous et transmettez-le uniquement au destinataire : il expire dans 24 heures.",
  en: "The invitation email could not be sent. Copy the link below and share it only with the recipient: it expires in 24 hours.",
};

async function deliverClientOwnerInvitation(runId: string, actorUserId: string): Promise<"sent" | "failed" | "busy"> {
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
  if (!claimed) return "busy";

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
    return "sent";
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
    return "failed";
  }
}

async function ownerInvitationLink(runId: string, actorUserId: string) {
  const db = requireDb();
  const [target] = await db
    .select({
      invitationId: clientProvisioningRuns.invitationId,
      organizationId: workspaces.authOrganizationId,
      workspaceId: clientProvisioningRuns.workspaceId,
    })
    .from(clientProvisioningRuns)
    .innerJoin(workspaces, eq(workspaces.id, clientProvisioningRuns.workspaceId))
    .where(eq(clientProvisioningRuns.id, runId))
    .limit(1);
  if (!target?.organizationId) throw new AdminRefusal(refusals.runNotFound);
  return issueInvitationLink({
    actorUserId,
    db,
    invitationId: target.invitationId,
    issuedBy: "platform_admin",
    organizationId: target.organizationId,
    workspaceId: target.workspaceId,
  });
}

export async function provisionClientWorkspaceAction(_previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const values = formValues(formData, clientFields);
  return run(async (locale) => {
    const { userId } = await requireAdmin();
    if (!isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED")) throw new AdminRefusal(refusals.gateClosed);
    const parsed = clientWorkspaceSchema.safeParse(Object.fromEntries(clientFields.map((field) => [field, formData.get(field)])));
    if (!parsed.success) {
      return actionFailure(localized(locale, { fr: "Vérifiez les champs signalés.", en: "Check the highlighted fields." }), {
        fieldErrors: fieldErrorsFromZod(parsed.error),
        values,
      });
    }
    const input = parsed.data;
    const organizationId = randomUUID();
    const invitationId = randomUUID();
    const db = requireDb();
    const provisioningRun = await db.transaction(async (tx) => {
      const [existingWorkspace] = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, input.slug))
        .limit(1);
      if (existingWorkspace) return null;

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
      const [createdRun] = await tx
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
      return createdRun;
    });
    if (!provisioningRun) {
      return actionFailure(refusals.slugTaken[locale], { fieldErrors: { slug: [refusals.slugTaken[locale]] }, values });
    }
    const delivery = await deliverClientOwnerInvitation(provisioningRun.id, userId);
    revalidatePath("/admin");
    if (delivery === "sent") {
      return actionSuccess(localized(locale, { fr: "Client créé, invitation envoyée au propriétaire.", en: "Client created, invitation sent to the owner." }));
    }
    return linkResult(locale, {
      fr: `Client créé. ${emailFailedCopy.fr}`,
      en: `Client created. ${emailFailedCopy.en}`,
    }, await ownerInvitationLink(provisioningRun.id, userId));
  }, values);
}

export async function retryClientOwnerInvitationAction(runId: string): Promise<AdminActionState> {
  return run(async (locale) => {
    const { userId } = await requireAdmin();
    if (!isFeatureEnabled("COMMERCIAL_ONBOARDING_ENABLED")) throw new AdminRefusal(refusals.gateClosed);
    const id = parse(idSchema, runId);
    const delivery = await deliverClientOwnerInvitation(id, userId);
    revalidatePath("/admin");
    if (delivery === "sent") return { fr: "Invitation renvoyée.", en: "Invitation resent." };
    if (delivery === "busy") return { fr: "Un envoi est déjà en cours pour ce client.", en: "A delivery is already in progress for this client." };
    return linkResult(locale, emailFailedCopy, await ownerInvitationLink(id, userId));
  });
}

export async function copyClientOwnerInvitationLinkAction(runId: string): Promise<AdminActionState> {
  return run(async (locale) => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, runId);
    const link = await ownerInvitationLink(id, userId);
    revalidatePath("/admin");
    return linkResult(locale, {
      fr: "Lien d’invitation prêt. Transmettez-le uniquement au propriétaire invité : il expire dans 24 heures.",
      en: "Invitation link ready. Share it only with the invited owner: it expires in 24 hours.",
    }, link);
  });
}

export async function reconcileClientOwnerAction(runId: string): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, runId);
    try {
      await reconcileOwnerProvisioningRun(id, userId);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("No accepted owner invitation")) {
        throw new AdminRefusal(refusals.noAcceptedOwner);
      }
      throw error;
    }
    revalidatePath("/admin");
    return { fr: "Propriétaire réconcilié.", en: "Owner reconciled." };
  });
}

export async function inviteWorkspaceMemberAction(workspaceId: string, _previous: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const values = formValues(formData, ["email"]);
  return run(async (locale) => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, workspaceId);
    const email = z.string().trim().email().max(320).safeParse(formData.get("email"));
    if (!email.success) {
      const message = localized(locale, { fr: "Indiquez une adresse email valide.", en: "Enter a valid email address." });
      return actionFailure(message, { fieldErrors: { email: [message] }, values });
    }
    const db = requireDb();
    const [workspace] = await db.select({
      authOrganizationId: workspaces.authOrganizationId,
      status: workspaces.status,
    }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!workspace || workspace.status !== "approved" || !workspace.authOrganizationId) {
      throw new AdminRefusal(refusals.notApproved);
    }
    const invitation = await inviteWorkspaceMember({
      actorUserId: userId,
      db,
      email: email.data.toLowerCase(),
      organizationId: workspace.authOrganizationId,
      workspaceId: id,
    });
    revalidatePath("/admin");
    if (invitation.delivered) return { fr: "Invitation envoyée.", en: "Invitation sent." };
    return linkResult(locale, emailFailedCopy, await issueInvitationLink({
      actorUserId: userId,
      db,
      invitationId: invitation.id,
      issuedBy: "platform_admin",
      organizationId: workspace.authOrganizationId,
      workspaceId: id,
    }));
  }, values);
}

export async function setPilotAccessAction(workspaceId: string, days: 30 | 60 | 90 | null): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, workspaceId);
    const durationDays = parse(pilotDaysSchema, days);
    const db = requireDb();
    const [workspace] = await db.select({ id: workspaces.id, status: workspaces.status }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!workspace || workspace.status !== "approved") throw new AdminRefusal(refusals.notApproved);
    const expiresAt = durationDays === null ? null : new Date(Date.now() + durationDays * 86_400_000);
    await db.transaction(async (tx) => {
      const updated = await tx.update(subscriptions).set({ pilotAccessExpiresAt: expiresAt, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, id)).returning({ id: subscriptions.id });
      if (!updated.length) throw new AdminRefusal(refusals.subscriptionMissing);
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
    return durationDays === null
      ? { fr: "Droit pilote révoqué.", en: "Pilot entitlement revoked." }
      : { fr: `Droit pilote accordé pour ${durationDays} jours.`, en: `Pilot entitlement granted for ${durationDays} days.` };
  });
}

export async function reviewWorkspaceAction(workspaceId: string, decision: "approved" | "rejected" | "limited"): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, workspaceId);
    const verdict = parse(workspaceDecisionSchema, decision);
    const db = requireDb();
    const [current] = await db.select({ status: workspaces.status }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
    if (!current) throw new AdminRefusal(refusals.workspaceNotFound);
    if (verdict === "approved" && current.status !== "pending_review") throw new AdminRefusal(refusals.notReviewed);
    await db.transaction(async (tx) => {
      if (verdict === "approved") {
        await tx.update(workspaces).set({ approvedAt: new Date(), dailyLimit: 50, dailyLimitOverriddenAt: null, pauseReason: null, pausedAt: null, status: "approved", warmupAdvancedAt: new Date(), warmupStage: 1, updatedAt: new Date() }).where(eq(workspaces.id, id));
        await tx.update(subscriptions).set({ plan: "beta", status: "inactive", graceEndsAt: null, updatedAt: new Date() }).where(eq(subscriptions.workspaceId, id));
      } else if (verdict === "rejected") {
        await tx.update(workspaces).set({ pauseReason: "admin_rejected", status: "rejected", updatedAt: new Date() }).where(eq(workspaces.id, id));
      } else {
        await tx.update(workspaces).set({ dailyLimit: 50, dailyLimitOverriddenAt: null, pauseReason: "admin_limited", pausedAt: new Date(), status: "paused", updatedAt: new Date() }).where(eq(workspaces.id, id));
      }
      const [review] = await tx.select().from(adminReviews).where(eq(adminReviews.workspaceId, id)).orderBy(adminReviews.createdAt).limit(1);
      if (review) await tx.update(adminReviews).set({ decision: verdict === "limited" ? "pending" : verdict, reviewedAt: new Date(), reviewedBy: userId, updatedAt: new Date() }).where(and(eq(adminReviews.id, review.id), eq(adminReviews.workspaceId, id)));
      await tx.insert(auditEvents).values({ action: `workspace.${verdict}`, actorUserId: userId, entityId: id, entityType: "workspace", workspaceId: id, metadata: { initialDailyLimit: 50 } });
    });
    revalidatePath("/admin");
    return done;
  });
}

export async function setWorkspaceContentPolicyAction(workspaceId: string, policy: "template_only" | "hybrid"): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, workspaceId);
    const contentPolicy = parse(contentPolicySchema, policy);
    await requireDb().transaction(async (tx) => {
      const updated = await tx.update(workspaces).set({ contentPolicy, updatedAt: new Date() }).where(eq(workspaces.id, id)).returning({ id: workspaces.id });
      if (!updated.length) throw new AdminRefusal(refusals.workspaceNotFound);
      await tx.insert(auditEvents).values({ workspaceId: id, actorUserId: userId, action: "workspace.content_policy_changed", entityType: "workspace", entityId: id, metadata: { policy: contentPolicy } });
    });
    revalidatePath("/admin");
    return done;
  });
}

export async function reviewTransactionalProfileAction(profileId: string, decision: "approved" | "rejected"): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, profileId);
    const verdict = parse(reviewDecisionSchema, decision);
    const db = requireDb();
    const [profile] = await db.select().from(transactionalProfiles).where(eq(transactionalProfiles.id, id)).limit(1);
    if (!profile) throw new AdminRefusal(refusals.profileNotFound);
    await db.transaction(async (tx) => {
      await tx.update(transactionalProfiles).set({ status: verdict, approvedAt: verdict === "approved" ? new Date() : null, approvedBy: verdict === "approved" ? userId : null, updatedAt: new Date() }).where(and(eq(transactionalProfiles.id, id), eq(transactionalProfiles.workspaceId, profile.workspaceId)));
      await tx.insert(auditEvents).values({ workspaceId: profile.workspaceId, actorUserId: userId, action: `transactional_profile.${verdict}`, entityType: "transactional_profile", entityId: id });
    });
    revalidatePath("/admin");
    return done;
  });
}

export async function reviewTemplateAction(templateId: string, decision: "approved" | "rejected"): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, templateId);
    const verdict = parse(reviewDecisionSchema, decision);
    const db = requireDb();
    const [template] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
    if (!template) throw new AdminRefusal(refusals.templateNotFound);
    await db.transaction(async (tx) => {
      await tx.update(templates).set({ reviewStatus: verdict, approvedAt: verdict === "approved" ? new Date() : null, approvedBy: verdict === "approved" ? userId : null, updatedAt: new Date() }).where(and(eq(templates.id, id), eq(templates.workspaceId, template.workspaceId)));
      await tx.insert(auditEvents).values({ workspaceId: template.workspaceId, actorUserId: userId, action: `template.${verdict}`, entityType: "template", entityId: id });
    });
    revalidatePath("/admin");
    return done;
  });
}

export async function provisionDomainAction(domainId: string, provider: "postmark" | "ses"): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, domainId);
    const target = parse(providerSchema, provider);
    const db = requireDb();
    const [domain] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    if (!domain) throw new AdminRefusal(refusals.domainNotFound);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, domain.workspaceId)).limit(1);
    if (!workspace || workspace.status !== "approved" || workspace.deletedAt || domain.status === "disabled") throw new AdminRefusal(refusals.domainUnavailable);
    if (target === "ses" && process.env.SES_ENABLED !== "true") throw new AdminRefusal(refusals.sesDisabled);
    if (target === "postmark" && process.env.POSTMARK_ENABLED !== "true") throw new AdminRefusal(refusals.postmarkDisabled);
    const [binding] = await db.insert(domainProviderBindings).values({ workspaceId: workspace.id, domainId: domain.id, provider: target, status: "pending" }).onConflictDoUpdate({
      target: [domainProviderBindings.domainId, domainProviderBindings.provider],
      set: { status: "pending", lastCheckError: sql`case when ${domainProviderBindings.lastCheckError} = ${POSTMARK_WEBHOOK_CREATE_UNCERTAIN} then ${POSTMARK_WEBHOOK_CREATE_UNCERTAIN} else null end`, updatedAt: new Date() },
      setWhere: and(eq(domainProviderBindings.workspaceId, workspace.id), inArray(domainProviderBindings.status, ["pending", "failed"]), eq(domainProviderBindings.isActive, false)),
    }).returning();
    if (!binding) throw new AdminRefusal(refusals.bindingLocked);
    await db.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "domain.provider_provisioning_requested", entityType: "domain", entityId: domain.id, metadata: { provider: target } });
    const queued = await enqueueProviderProvisioning(workspace.id, binding.id);
    if (queued.local) await provisionBinding(workspace.id, binding.id);
    revalidatePath("/admin");
    revalidatePath("/dashboard/domaines");
    return { fr: "Provisionnement demandé.", en: "Provisioning requested." };
  });
}

export async function activateDomainBindingAction(bindingId: string): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, bindingId);
    const db = requireDb();
    const [binding] = await db.select().from(domainProviderBindings).where(eq(domainProviderBindings.id, id)).limit(1);
    if (!binding || binding.status !== "verified") throw new AdminRefusal(refusals.bindingNotVerified);
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
    return done;
  });
}

export async function setProviderAccountStatusAction(accountId: string, status: "ready" | "paused" | "disabled"): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, accountId);
    const nextStatus = parse(providerAccountStatusSchema, status);
    const db = requireDb();
    const [account] = await db.select().from(workspaceProviderAccounts).where(eq(workspaceProviderAccounts.id, id)).limit(1);
    if (!account) throw new AdminRefusal(refusals.accountNotFound);
    if (nextStatus === "ready" && !account.externalAccountId) throw new AdminRefusal(refusals.accountNotProvisioned);
    await db.transaction(async (tx) => {
      await tx.update(workspaceProviderAccounts).set({
        status: nextStatus,
        pausedAt: nextStatus === "paused" ? new Date() : null,
        pauseReason: nextStatus === "paused" ? "admin_pause" : nextStatus === "disabled" ? "admin_disabled" : null,
        updatedAt: new Date(),
      }).where(and(eq(workspaceProviderAccounts.id, id), eq(workspaceProviderAccounts.workspaceId, account.workspaceId)));
      await tx.insert(auditEvents).values({ workspaceId: account.workspaceId, actorUserId: userId, action: `provider_account.${nextStatus}`, entityType: "provider_account", entityId: id, metadata: { provider: account.provider } });
    });
    revalidatePath("/admin");
    return done;
  });
}

export async function disableDomainBindingAction(bindingId: string): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, bindingId);
    const db = requireDb();
    const [binding] = await db.select().from(domainProviderBindings).where(eq(domainProviderBindings.id, id)).limit(1);
    if (!binding) throw new AdminRefusal(refusals.bindingNotFound);
    await db.transaction(async (tx) => {
      await tx.update(domainProviderBindings).set({ isActive: false, status: "disabled", updatedAt: new Date() }).where(and(eq(domainProviderBindings.id, id), eq(domainProviderBindings.workspaceId, binding.workspaceId)));
      if (binding.isActive) {
        await tx.update(domains).set({ activeProvider: null, status: "disabled", updatedAt: new Date() }).where(and(eq(domains.id, binding.domainId), eq(domains.workspaceId, binding.workspaceId)));
      }
      await tx.insert(auditEvents).values({ workspaceId: binding.workspaceId, actorUserId: userId, action: "domain.provider_disabled", entityType: "domain_binding", entityId: id, metadata: { provider: binding.provider } });
    });
    revalidatePath("/admin");
    revalidatePath("/dashboard/domaines");
    return done;
  });
}

export async function disableTransactionalProfileAction(profileId: string): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, profileId);
    const db = requireDb();
    const [profile] = await db.select().from(transactionalProfiles).where(eq(transactionalProfiles.id, id)).limit(1);
    if (!profile) throw new AdminRefusal(refusals.profileNotFound);
    await db.transaction(async (tx) => {
      await tx.update(transactionalProfiles).set({ status: "disabled", updatedAt: new Date() }).where(and(eq(transactionalProfiles.id, id), eq(transactionalProfiles.workspaceId, profile.workspaceId)));
      await tx.insert(auditEvents).values({ workspaceId: profile.workspaceId, actorUserId: userId, action: "transactional_profile.disabled_by_admin", entityType: "transactional_profile", entityId: id });
    });
    revalidatePath("/admin");
    return done;
  });
}

export async function disableTemplateAction(templateId: string): Promise<AdminActionState> {
  return run(async () => {
    const { userId } = await requireAdmin();
    const id = parse(idSchema, templateId);
    const db = requireDb();
    const [template] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
    if (!template) throw new AdminRefusal(refusals.templateNotFound);
    await db.transaction(async (tx) => {
      await tx.update(templates).set({ reviewStatus: "disabled", updatedAt: new Date() }).where(and(eq(templates.id, id), eq(templates.workspaceId, template.workspaceId)));
      await tx.insert(auditEvents).values({ workspaceId: template.workspaceId, actorUserId: userId, action: "template.disabled_by_admin", entityType: "template", entityId: id });
    });
    revalidatePath("/admin");
    return done;
  });
}
