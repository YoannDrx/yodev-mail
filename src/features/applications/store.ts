import "server-only";

import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { auditEvents, betaApplications } from "@/db/schema";
import type { BetaApplicationInput } from "@/features/applications/schema";
import type { Locale } from "@/i18n/config";

/**
 * Public form throttling. The per-IP limit uses a keyed hash, never the raw
 * address; the global cap protects the review queue if the hash is missing
 * or the form is attacked from many addresses.
 */
export const betaApplicationLimits = {
  windowMs: 60 * 60 * 1000,
  perIp: 3,
  global: 60,
} as const;

export type BetaApplicationStatus = "new" | "reviewed";

export async function recordBetaApplication(
  input: BetaApplicationInput,
  options: { ipHash: string | null; locale: Locale; now?: Date },
): Promise<{ status: "created"; id: string } | { status: "rate_limited" }> {
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - betaApplicationLimits.windowMs);
  return requireDb().transaction(async (tx) => {
    // Serialize the count-then-insert check; submissions are rare.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('beta_applications_rate_limit'))`);
    const [global] = await tx
      .select({ total: count() })
      .from(betaApplications)
      .where(gte(betaApplications.createdAt, since));
    if ((global?.total ?? 0) >= betaApplicationLimits.global) return { status: "rate_limited" as const };
    if (options.ipHash) {
      const [perIp] = await tx
        .select({ total: count() })
        .from(betaApplications)
        .where(and(eq(betaApplications.ipHash, options.ipHash), gte(betaApplications.createdAt, since)));
      if ((perIp?.total ?? 0) >= betaApplicationLimits.perIp) return { status: "rate_limited" as const };
    }
    const [row] = await tx
      .insert(betaApplications)
      .values({
        company: input.company,
        contactName: input.contactName,
        workEmail: input.workEmail,
        websiteUrl: input.websiteUrl,
        useCase: input.useCase,
        expectedMonthlyVolume: input.expectedMonthlyVolume,
        locale: options.locale,
        consentedAt: now,
        ipHash: options.ipHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: betaApplications.id });
    return { status: "created" as const, id: row.id };
  });
}

/**
 * Platform-level review queue (no workspace exists yet for an applicant).
 * Callers must have checked that the viewer is a platform admin; the admin
 * page does so with requireAdmin() before calling this.
 */
export async function queryBetaApplications(options: { status?: BetaApplicationStatus; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  return requireDb()
    .select({
      id: betaApplications.id,
      company: betaApplications.company,
      contactName: betaApplications.contactName,
      workEmail: betaApplications.workEmail,
      websiteUrl: betaApplications.websiteUrl,
      useCase: betaApplications.useCase,
      expectedMonthlyVolume: betaApplications.expectedMonthlyVolume,
      locale: betaApplications.locale,
      consentedAt: betaApplications.consentedAt,
      status: betaApplications.status,
      reviewedAt: betaApplications.reviewedAt,
      reviewedBy: betaApplications.reviewedBy,
      createdAt: betaApplications.createdAt,
    })
    .from(betaApplications)
    .where(options.status ? eq(betaApplications.status, options.status) : undefined)
    .orderBy(desc(betaApplications.createdAt), desc(betaApplications.id))
    .limit(limit);
}

/** Idempotent: an application already reviewed keeps its first reviewer. */
export async function markBetaApplicationReviewed(applicationId: string, reviewerId: string, now = new Date()) {
  return requireDb().transaction(async (tx) => {
    const [row] = await tx
      .update(betaApplications)
      .set({ status: "reviewed", reviewedAt: now, reviewedBy: reviewerId, updatedAt: now })
      .where(and(eq(betaApplications.id, applicationId), eq(betaApplications.status, "new")))
      .returning({ id: betaApplications.id });
    if (!row) {
      const [existing] = await tx
        .select({ id: betaApplications.id })
        .from(betaApplications)
        .where(eq(betaApplications.id, applicationId))
        .limit(1);
      return existing ? "already_reviewed" as const : "not_found" as const;
    }
    // No applicant data in the audit trail: the opaque id is enough.
    await tx.insert(auditEvents).values({
      workspaceId: null,
      actorUserId: reviewerId,
      action: "beta_application.reviewed",
      entityType: "beta_application",
      entityId: applicationId,
      metadata: {},
      createdAt: now,
    });
    return "reviewed" as const;
  });
}
