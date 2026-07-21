import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireDb } from "@/db";
import {
  campaigns,
  emailEvents,
  messageAttempts,
  messages,
  subscriptions,
  usageDays,
  usageMonths,
  workspaces,
} from "@/db/schema";
import { utcDay } from "@/features/sending/eligibility";

export async function getDashboardData(workspaceId: string) {
  const db = requireDb();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const since = utcDay(new Date(now.getTime() - 29 * 864e5));
  const [workspace, usage, today, activity, recentCampaigns, statusCounts, subscription] =
    await Promise.all([
      db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(usageMonths)
        .where(
          and(
            eq(usageMonths.workspaceId, workspaceId),
            eq(usageMonths.month, month),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(usageDays)
        .where(
          and(
            eq(usageDays.workspaceId, workspaceId),
            eq(usageDays.day, utcDay(now)),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select()
        .from(usageDays)
        .where(
          and(
            eq(usageDays.workspaceId, workspaceId),
            gte(usageDays.day, since),
          ),
        )
        .orderBy(usageDays.day),
      db
        .select()
        .from(campaigns)
        .where(eq(campaigns.workspaceId, workspaceId))
        .orderBy(desc(campaigns.createdAt))
        .limit(5),
      db
        .select({ count: sql<number>`count(*)::int`, status: messages.status })
        .from(messages)
        .where(eq(messages.workspaceId, workspaceId))
        .groupBy(messages.status),
      db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, workspaceId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
  if (!workspace) throw new Error("Workspace not found");
  const totals = activity.reduce(
    (result, day) => ({
      accepted: result.accepted + day.acceptedEmails,
      complaints: result.complaints + day.complaints,
      delivered: result.delivered + day.deliveredEmails,
      hardBounces: result.hardBounces + day.hardBounces,
    }),
    { accepted: 0, complaints: 0, delivered: 0, hardBounces: 0 },
  );
  return {
    activity,
    currentMonthAccepted: usage?.acceptedEmails ?? 0,
    recentCampaigns,
    statusCounts: Object.fromEntries(statusCounts.map((row) => [row.status, row.count])),
    subscription,
    todayAccepted: today?.acceptedEmails ?? 0,
    totals,
    workspace,
  };
}

export async function getRecentMessages(workspaceId: string, limit = 100) {
  return requireDb()
    .select({
      acceptedAt: messages.acceptedAt,
      createdAt: messages.createdAt,
      deliveredAt: messages.deliveredAt,
      fromEmail: messages.fromEmail,
      id: messages.id,
      lastError: messages.lastError,
      lastEventAt: messages.lastEventAt,
      source: messages.source,
      status: messages.status,
      stream: messages.stream,
      subject: messages.subject,
      toEmail: messages.toEmail,
    })
    .from(messages)
    .where(eq(messages.workspaceId, workspaceId))
    .orderBy(desc(messages.createdAt))
    .limit(Math.min(limit, 250));
}

export async function getMessageDetail(workspaceId: string, messageId: string) {
  const db = requireDb();
  const [message, attempts, events] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.workspaceId, workspaceId), eq(messages.id, messageId)))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select({
        attempt: messageAttempts.attempt,
        createdAt: messageAttempts.createdAt,
        errorCode: messageAttempts.errorCode,
        errorMessage: messageAttempts.errorMessage,
        id: messageAttempts.id,
        status: messageAttempts.status,
      })
      .from(messageAttempts)
      .innerJoin(messages, eq(messages.id, messageAttempts.messageId))
      .where(and(eq(messageAttempts.workspaceId, workspaceId), eq(messages.workspaceId, workspaceId), eq(messageAttempts.messageId, messageId)))
      .orderBy(desc(messageAttempts.createdAt)),
    db
      .select({
        id: emailEvents.id,
        occurredAt: emailEvents.occurredAt,
        type: emailEvents.type,
      })
      .from(emailEvents)
      .where(and(eq(emailEvents.workspaceId, workspaceId), eq(emailEvents.messageId, messageId)))
      .orderBy(desc(emailEvents.occurredAt)),
  ]);
  return message ? { message, attempts, events } : null;
}

export async function getReputationWindow(workspaceId: string, days = 30) {
  const since = utcDay(new Date(Date.now() - (days - 1) * 864e5));
  const [row] = await requireDb()
    .select({
      accepted: sql<number>`coalesce(sum(${usageDays.acceptedEmails}), 0)::int`,
      complaints: sql<number>`coalesce(sum(${usageDays.complaints}), 0)::int`,
      delivered: sql<number>`coalesce(sum(${usageDays.deliveredEmails}), 0)::int`,
      hardBounces: sql<number>`coalesce(sum(${usageDays.hardBounces}), 0)::int`,
    })
    .from(usageDays)
    .where(
      and(
        eq(usageDays.workspaceId, workspaceId),
        gte(usageDays.day, since),
      ),
    );
  return row ?? { accepted: 0, complaints: 0, delivered: 0, hardBounces: 0 };
}
