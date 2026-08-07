import type { S3Event } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb } from "@/db/runtime";
import { contactListMembers, contactLists, contacts, importJobs } from "@/db/schema";
import { normalizeEmail } from "@/features/contacts/normalization";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

const emailSchema = z.string().trim().email().max(320);
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 100_000;

function field(row: Record<string, string>, mapping: Record<string, string>, key: string) {
  const column = mapping[key];
  return column ? row[column]?.trim() || undefined : undefined;
}

export async function handler(event: S3Event) {
  await loadRuntimeSecrets();
  const s3 = new S3Client({});
  for (const record of event.Records) {
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    const jobId = key.split("/").at(-1)?.replace(/\.csv$/i, "");
    if (!jobId || record.s3.object.size > MAX_BYTES) continue;

    const db = requireDb();
    const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
    if (!job || job.objectKey !== key || !key.startsWith(`${job.workspaceId}/`)) continue;
    await db
      .update(importJobs)
      .set({ status: "processing", updatedAt: new Date() })
      .where(and(eq(importJobs.id, job.id), eq(importJobs.workspaceId, job.workspaceId)));

    try {
      if (job.listId) {
        const [list] = await db
          .select({ id: contactLists.id })
          .from(contactLists)
          .where(and(eq(contactLists.id, job.listId), eq(contactLists.workspaceId, job.workspaceId)))
          .limit(1);
        if (!list) throw new Error("Target list no longer exists");
      }
      const object = await s3.send(new GetObjectCommand({ Bucket: record.s3.bucket.name, Key: key }));
      if ((object.ContentLength ?? 0) > MAX_BYTES) throw new Error("CSV exceeds 10 MB");
      const csv = await object.Body?.transformToString();
      const rows = parse(csv ?? "", {
        bom: true,
        columns: true,
        max_record_size: 100_000,
        relax_column_count: false,
        skip_empty_lines: true,
      }) as Record<string, string>[];
      if (rows.length > MAX_ROWS) throw new Error("CSV exceeds 100,000 rows");

      let imported = 0;
      let rejected = 0;
      const errorSummary: Array<Record<string, unknown>> = [];
      for (const [index, row] of rows.entries()) {
        const parsedEmail = emailSchema.safeParse(field(row, job.mapping, "email"));
        if (!parsedEmail.success) {
          rejected += 1;
          if (errorSummary.length < 50) errorSummary.push({ row: index + 2, code: "invalid_email" });
          continue;
        }
        const email = parsedEmail.data;
        const tags = (field(row, job.mapping, "tags") ?? "")
          .split(/[|,;]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 30);
        const [contact] = await db
          .insert(contacts)
          .values({
            workspaceId: job.workspaceId,
            email,
            normalizedEmail: normalizeEmail(email),
            firstName: field(row, job.mapping, "firstName")?.slice(0, 120),
            lastName: field(row, job.mapping, "lastName")?.slice(0, 120),
            company: field(row, job.mapping, "company")?.slice(0, 180),
            locale: field(row, job.mapping, "locale")?.slice(0, 8) || "fr",
            tags,
            marketingConsent: false,
            trackingConsent: false,
          })
          .onConflictDoUpdate({
            target: [contacts.workspaceId, contacts.normalizedEmail],
            set: {
              firstName: field(row, job.mapping, "firstName")?.slice(0, 120),
              lastName: field(row, job.mapping, "lastName")?.slice(0, 120),
              company: field(row, job.mapping, "company")?.slice(0, 180),
              locale: field(row, job.mapping, "locale")?.slice(0, 8) || "fr",
              tags,
              updatedAt: new Date(),
            },
          })
          .returning({ id: contacts.id });
        if (job.listId) {
          await db.insert(contactListMembers).values({
            workspaceId: job.workspaceId,
            listId: job.listId,
            contactId: contact.id,
          }).onConflictDoNothing();
        }
        imported += 1;
      }
      await db
        .update(importJobs)
        .set({
          status: "completed",
          processedRows: rows.length,
          importedRows: imported,
          rejectedRows: rejected,
          errorSummary,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(eq(importJobs.id, job.id), eq(importJobs.workspaceId, job.workspaceId)));
    } catch (error) {
      await db
        .update(importJobs)
        .set({
          status: "failed",
          errorSummary: [{ message: error instanceof Error ? error.message : "Import failed" }],
          updatedAt: new Date(),
        })
        .where(and(eq(importJobs.id, job.id), eq(importJobs.workspaceId, job.workspaceId)));
      throw error;
    }
  }
}
