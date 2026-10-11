import { and, desc, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import { messages, messageStatusEnum, transactionalProfiles } from "@/db/schema";
import { nextDay, zonedDayStart } from "@/lib/date-time";

type Database = ReturnType<typeof requireDb>;
export type MessageStatus = (typeof messageStatusEnum.enumValues)[number];

export const messageStatuses = messageStatusEnum.enumValues;
export const emailsPageSize = 50;

export type EmailListFilters = {
  status?: MessageStatus;
  /** Calendar days (YYYY-MM-DD) in the workspace time zone, both inclusive. */
  from?: string;
  to?: string;
  cursor?: string;
};

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/** Reads untrusted search parameters; anything invalid is ignored rather than failing the page. */
export function parseEmailListFilters(params: Record<string, string | string[] | undefined>): EmailListFilters {
  const single = (name: string) => {
    const value = params[name];
    return typeof value === "string" && value ? value : undefined;
  };
  const status = single("status");
  const from = single("from");
  const to = single("to");
  return {
    status: messageStatuses.includes(status as MessageStatus) ? (status as MessageStatus) : undefined,
    from: from && dayPattern.test(from) ? from : undefined,
    to: to && dayPattern.test(to) ? to : undefined,
    cursor: single("cursor"),
  };
}

// Postgres keeps microseconds while Date keeps milliseconds: the cursor carries
// the exact database timestamp so rows sharing a millisecond are never skipped.
const exactCreatedAt = sql<string>`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const cursorTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeCursor(row: { exactCreatedAt: string; id: string }) {
  return Buffer.from(`${row.exactCreatedAt}|${row.id}`).toString("base64url");
}

export function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [createdAt, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (!cursorTimestampPattern.test(createdAt ?? "") || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id ?? "")) return null;
  return { createdAt: createdAt!, id: id! };
}

/**
 * Keyset pagination over (created_at, id), newest first: stable while new
 * messages arrive and served by the workspace/status/created_at index.
 */
export async function listWorkspaceEmails(db: Database, workspaceId: string, filters: EmailListFilters, timeZone: string, pageSize = emailsPageSize) {
  const conditions: SQL[] = [eq(messages.workspaceId, workspaceId)];
  if (filters.status) conditions.push(eq(messages.status, filters.status));
  const from = filters.from ? zonedDayStart(filters.from, timeZone) : null;
  if (from) conditions.push(gte(messages.createdAt, from));
  const to = filters.to ? zonedDayStart(nextDay(filters.to), timeZone) : null;
  if (to) conditions.push(lt(messages.createdAt, to));
  const cursor = decodeCursor(filters.cursor);
  if (cursor) {
    const at = sql`${cursor.createdAt}::timestamptz`;
    conditions.push(or(
      sql`${messages.createdAt} < ${at}`,
      and(sql`${messages.createdAt} = ${at}`, lt(messages.id, cursor.id)),
    )!);
  }
  const rows = await db
    .select({
      category: transactionalProfiles.key,
      createdAt: messages.createdAt,
      exactCreatedAt,
      id: messages.id,
      lastError: messages.lastError,
      sendMode: messages.sendMode,
      status: messages.status,
      subject: messages.subject,
      toEmail: messages.toEmail,
    })
    .from(messages)
    .leftJoin(transactionalProfiles, and(eq(transactionalProfiles.id, messages.transactionalProfileId), eq(transactionalProfiles.workspaceId, messages.workspaceId)))
    .where(and(...conditions))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(pageSize + 1);
  const page = rows.slice(0, pageSize);
  return {
    rows: page,
    nextCursor: rows.length > pageSize ? encodeCursor(page[page.length - 1]) : null,
  };
}
