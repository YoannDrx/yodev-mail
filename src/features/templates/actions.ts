"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, templates, templateVersions } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";

const schema = z.object({
  body: z.string().trim().min(1).max(100_000),
  name: z.string().trim().min(2).max(160),
  subject: z.string().trim().min(1).max(255),
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
  const html = `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#18151f">${data.body.split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`).join("")}</div>`;
  await requireDb().transaction(async (tx) => {
    const [template] = await tx.insert(templates).values({
      name: data.name,
      subject: data.subject,
      workspaceId: workspace.id,
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
