import { and, eq } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import {
  domainProviderBindings,
  domains,
  subscriptions,
  suppressions,
  transactionalProfiles,
  usageDays,
  workspaceProviderAccounts,
  workspaces,
} from "@/db/schema";
import { suppressionHash } from "@/features/email-address/normalization";
import {
  evaluateSendingEligibility,
  type EligibilityResult,
} from "@/features/sending/policy";

type Database = ReturnType<typeof requireDb>;

export function utcDay(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export async function evaluateStoredMessage(
  db: Database,
  input: {
    workspaceId: string;
    domainId: string;
    toEmail: string;
    mode: "test" | "live";
    profileId: string;
    provider: "ses" | "postmark";
    dailyOffset?: number;
    now?: Date;
  },
): Promise<EligibilityResult> {
  const now = input.now ?? new Date();
  const [binding, providerAccount, profile, workspace, domain, subscription, usage, suppression] =
    await Promise.all([
      db
        .select()
        .from(domainProviderBindings)
        .where(
          and(
            eq(domainProviderBindings.domainId, input.domainId),
            eq(domainProviderBindings.workspaceId, input.workspaceId),
            eq(domainProviderBindings.provider, input.provider),
            eq(domainProviderBindings.isActive, true),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(workspaceProviderAccounts)
        .where(
          and(
            eq(workspaceProviderAccounts.workspaceId, input.workspaceId),
            eq(workspaceProviderAccounts.provider, input.provider),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(transactionalProfiles)
        .where(
          and(
            eq(transactionalProfiles.id, input.profileId),
            eq(transactionalProfiles.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, input.workspaceId))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(domains)
        .where(
          and(
            eq(domains.id, input.domainId),
            eq(domains.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, input.workspaceId))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(usageDays)
        .where(
          and(
            eq(usageDays.workspaceId, input.workspaceId),
            eq(usageDays.day, utcDay(now)),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({ id: suppressions.id })
        .from(suppressions)
        .where(
          and(
            eq(suppressions.workspaceId, input.workspaceId),
            eq(suppressions.emailHash, suppressionHash(input.toEmail)),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
    ]);

  if (!workspace || !domain) {
    return {
      allowed: false,
      code: "workspace_or_domain_missing",
      reason: "Le workspace ou le domaine expéditeur est introuvable.",
    };
  }

  if (!profile || profile.status !== "approved") {
    return {
      allowed: false,
      code: "transactional_profile_not_approved",
      reason: "Le cas d’usage transactionnel doit être approuvé.",
    };
  }

  if (!binding || binding.status !== "verified" || !binding.isActive) {
    return {
      allowed: false,
      code: "provider_binding_not_ready",
      reason: "Le domaine expéditeur n’est pas prêt pour la livraison.",
    };
  }

  if (!providerAccount || providerAccount.status !== "ready") {
    return {
      allowed: false,
      code: "provider_account_not_ready",
      reason: "Le service de livraison du workspace n’est pas prêt.",
    };
  }

  return evaluateSendingEligibility({
    billingStatus: subscription?.status ?? "inactive",
    dailyLimit: workspace.dailyLimit,
    dailySent: (usage?.acceptedEmails ?? 0) + (input.dailyOffset ?? 0),
    domainVerified: domain.status === "verified" && binding.dkimStatus === "verified",
    graceEndsAt: subscription?.graceEndsAt,
    mode: input.mode,
    now,
    suppressed: Boolean(suppression),
    workspaceStatus: workspace.status,
  });
}
