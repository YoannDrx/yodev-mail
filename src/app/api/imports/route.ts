import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, contactLists, importJobs } from "@/db/schema";
import { awsClients } from "@/lib/aws";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";

const requestSchema = z.object({
  fileName: z.string().min(1).max(255).refine((name) => name.toLowerCase().endsWith(".csv"), "Le fichier doit être un CSV"),
  fileSize: z.number().int().positive().max(10 * 1024 * 1024),
  listId: z.string().uuid().nullable().optional(),
  mapping: z.object({
    email: z.string().min(1).max(200),
    firstName: z.string().max(200).optional(),
    lastName: z.string().max(200).optional(),
    company: z.string().max(200).optional(),
    locale: z.string().max(200).optional(),
    tags: z.string().max(200).optional(),
  }),
});

export async function POST(request: Request) {
  if (!env.AWS_IMPORT_BUCKET) {
    return NextResponse.json({ error: "Les imports AWS ne sont pas configurés." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Fichier ou mapping invalide." }, { status: 400 });
  }

  const { workspace, userId } = await currentWorkspace();
  const db = requireDb();
  if (parsed.data.listId) {
    const [list] = await db
      .select({ id: contactLists.id })
      .from(contactLists)
      .where(and(eq(contactLists.id, parsed.data.listId), eq(contactLists.workspaceId, workspace.id)))
      .limit(1);
    if (!list) return NextResponse.json({ error: "Liste introuvable." }, { status: 404 });
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      workspaceId: workspace.id,
      objectKey: "pending",
      listId: parsed.data.listId ?? null,
      mapping: Object.fromEntries(Object.entries(parsed.data.mapping).filter(([, value]) => value)),
      createdBy: userId,
    })
    .returning({ id: importJobs.id });
  const objectKey = `${workspace.id}/${job.id}.csv`;
  await db.transaction(async (tx) => {
    await tx
      .update(importJobs)
      .set({ objectKey, updatedAt: new Date() })
      .where(and(eq(importJobs.id, job.id), eq(importJobs.workspaceId, workspace.id)));
    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "contacts.import_created",
      entityType: "import_job",
      entityId: job.id,
      metadata: { fileSize: parsed.data.fileSize, listId: parsed.data.listId ?? null },
    });
  });

  try {
    const { s3 } = await awsClients();
    const uploadUrl = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: env.AWS_IMPORT_BUCKET,
        Key: objectKey,
        ContentType: "text/csv",
        Metadata: { importJobId: job.id, workspaceId: workspace.id },
      }),
      { expiresIn: 300 },
    );
    return NextResponse.json({ jobId: job.id, uploadUrl }, { status: 201 });
  } catch (error) {
    await db
      .update(importJobs)
      .set({ status: "failed", errorSummary: [{ message: "Impossible de préparer le transfert AWS" }], updatedAt: new Date() })
      .where(and(eq(importJobs.id, job.id), eq(importJobs.workspaceId, workspace.id)));
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Impossible de préparer l’import." },
      { status: 502 },
    );
  }
}
