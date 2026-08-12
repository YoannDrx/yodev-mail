"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, templates, templateVersions, transactionalProfiles } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";
import { sha256 } from "@/lib/crypto";

const schema = z.object({
  body: z.string().trim().min(1).max(100_000),
  name: z.string().trim().min(2).max(160),
  subject: z.string().trim().min(1).max(255),
  transactionalProfileId: z.string().uuid(),
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!);
}

export async function createTemplateAction(formData: FormData) {
  const data = schema.parse(Object.fromEntries(formData));
  const { workspace, userId } = await currentWorkspace();
  const db = requireDb();
  const [profile] = await db.select({ id: transactionalProfiles.id }).from(transactionalProfiles).where(and(
    eq(transactionalProfiles.id, data.transactionalProfileId),
    eq(transactionalProfiles.workspaceId, workspace.id),
  )).limit(1);
  if (!profile) throw new Error("Transactional profile not found");
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18151f">${data.body.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("")}</div>`;
  await db.transaction(async (tx) => {
    const [template] = await tx.insert(templates).values({
      name: data.name,
      subject: data.subject,
      workspaceId: workspace.id,
      transactionalProfileId: data.transactionalProfileId,
      reviewStatus: "pending_review",
      contentHash: sha256(`${data.subject}\0${html}\0${data.body}`),
      submittedAt: new Date(),
    }).returning();
    await tx.insert(templateVersions).values({
      workspaceId: workspace.id,
      createdBy: userId,
      document: { version: 1, blocks: [{ type: "text", value: data.body }] },
      html,
      plainText: data.body,
      templateId: template.id,
      version: 1,
    });
    await tx.insert(auditEvents).values({
      action: "template.created",
      actorUserId: userId,
      entityId: template.id,
      entityType: "template",
      workspaceId: workspace.id,
    });
  });
  revalidatePath("/dashboard/templates");
}
