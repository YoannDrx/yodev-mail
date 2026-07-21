import { and, eq } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import {
  contacts,
  domains,
  subscriptions,
  suppressions,
  usageDays,
  workspaces,
} from "@/db/schema";
import { suppressionHash } from "@/features/contacts/normalization";
import {
  evaluateSendingEligibility,
  type EligibilityResult,
} from "@/features/sending/policy";

type Database = ReturnType<typeof requireDb>;

export const SES_SIMULATOR_DOMAIN = "simulator.amazonses.com";

export function isSesSimulatorAddress(email: string) {
  return email.trim().toLowerCase().endsWith(`@${SES_SIMULATOR_DOMAIN}`);
}

export function utcDay(value = new Date()) {
  return value.toISOString().slice(0, 10);
}

export async function evaluateStoredMessage(
  db: Database,
  input: {
    workspaceId: string;
    domainId: string;
    toEmail: string;
    stream: "transactional" | "marketing";
    mode: "test" | "live";
    contactId?: string | null;
    dailyOffset?: number;
    now?: Date;
  },
): Promise<EligibilityResult> {
  const now = input.now ?? new Date();
  const [workspace, domain, subscription, usage, suppression, contact] =
    await Promise.all([
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
      input.contactId
        ? db
            .select()
            .from(contacts)
            .where(
              and(
                eq(contacts.id, input.contactId),
                eq(contacts.workspaceId, input.workspaceId),
              ),
            )
            .limit(1)
            .then((rows) => rows[0])
        : Promise.resolve(undefined),
    ]);

  if (!workspace || !domain) {
    return {
      allowed: false,
      code: "workspace_or_domain_missing",
      reason: "Le workspace ou le domaine expéditeur est introuvable.",
    };
  }

  if (input.mode === "test" && !isSesSimulatorAddress(input.toEmail)) {
    return {
      allowed: false,
      code: "test_recipient_forbidden",
      reason: "Une clé de test ne peut envoyer qu'au simulateur Amazon SES.",
    };
  }

  return evaluateSendingEligibility({
    billingStatus: subscription?.status ?? "inactive",
    dailyLimit: workspace.dailyLimit,
    dailySent: (usage?.acceptedEmails ?? 0) + (input.dailyOffset ?? 0),
    domainVerified:
      domain.status === "verified" && domain.dkimStatus === "verified",
    graceEndsAt: subscription?.graceEndsAt,
    marketingConsent:
      input.stream === "marketing" && contact
        ? contact.status === "active" &&
          (contact.marketingConsent || Boolean(contact.legalBasis))
        : undefined,
    mode: input.mode,
    now,
    stream: input.stream,
    suppressed: Boolean(suppression),
    workspaceStatus: workspace.status,
  });
}
