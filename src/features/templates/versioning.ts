import { and, desc, eq, sql } from "drizzle-orm";
import type { requireDb } from "@/db/runtime";
import { auditEvents, templates, templateVersions, transactionalProfiles } from "@/db/schema";
import { templateHtmlFromText } from "@/features/templates/document";
import { sha256 } from "@/lib/crypto";

type Database = ReturnType<typeof requireDb>;

export class TemplateNotEditableError extends Error {
  constructor(readonly reason: "not_found" | "disabled" | "profile_not_found") {
    super(`Template cannot be saved: ${reason}`);
    this.name = "TemplateNotEditableError";
  }
}

function contentHash(subject: string, html: string, body: string) {
  return sha256(`${subject}\0${html}\0${body}`);
}

export async function createTemplate(db: Database, input: {
  workspaceId: string;
  userId: string;
  transactionalProfileId: string;
  name: string;
  subject: string;
  body: string;
}) {
  const html = templateHtmlFromText(input.body);
  return db.transaction(async (tx) => {
    const [profile] = await tx.select({ id: transactionalProfiles.id }).from(transactionalProfiles).where(and(
      eq(transactionalProfiles.id, input.transactionalProfileId),
      eq(transactionalProfiles.workspaceId, input.workspaceId),
    )).limit(1);
    if (!profile) throw new TemplateNotEditableError("profile_not_found");
    const [template] = await tx.insert(templates).values({
      name: input.name,
      subject: input.subject,
      workspaceId: input.workspaceId,
      transactionalProfileId: profile.id,
      reviewStatus: "pending_review",
      contentHash: contentHash(input.subject, html, input.body),
      submittedAt: new Date(),
    }).returning();
    await tx.insert(templateVersions).values({
      workspaceId: input.workspaceId,
      createdBy: input.userId,
      document: { version: 1, blocks: [{ type: "text", value: input.body }] },
      html,
      plainText: input.body,
      templateId: template.id,
      version: 1,
    });
    await tx.insert(auditEvents).values({
      action: "template.created",
      actorUserId: input.userId,
      entityId: template.id,
      entityType: "template",
      workspaceId: input.workspaceId,
    });
    return template;
  });
}

/**
 * Saves an edit as a new immutable version. The API always serves the latest
 * version of an approved template, so an edit sends the whole template back to
 * review: unreviewed content can never be delivered.
 */
export async function createTemplateVersion(db: Database, input: {
  workspaceId: string;
  userId: string;
  templateId: string;
  name: string;
  subject: string;
  body: string;
}) {
  const html = templateHtmlFromText(input.body);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select ${templates.id} from ${templates} where ${templates.id} = ${input.templateId} and ${templates.workspaceId} = ${input.workspaceId} for update`);
    const [template] = await tx.select().from(templates).where(and(
      eq(templates.id, input.templateId),
      eq(templates.workspaceId, input.workspaceId),
    )).limit(1);
    if (!template) throw new TemplateNotEditableError("not_found");
    if (template.reviewStatus === "disabled") throw new TemplateNotEditableError("disabled");
    const [latest] = await tx.select({ version: templateVersions.version }).from(templateVersions).where(and(
      eq(templateVersions.templateId, template.id),
      eq(templateVersions.workspaceId, input.workspaceId),
    )).orderBy(desc(templateVersions.version)).limit(1);
    const version = Math.max(latest?.version ?? 0, template.currentVersion) + 1;
    await tx.insert(templateVersions).values({
      workspaceId: input.workspaceId,
      createdBy: input.userId,
      document: { version: 1, blocks: [{ type: "text", value: input.body }] },
      html,
      plainText: input.body,
      templateId: template.id,
      version,
    });
    const now = new Date();
    await tx.update(templates).set({
      name: input.name,
      subject: input.subject,
      currentVersion: version,
      reviewStatus: "pending_review",
      contentHash: contentHash(input.subject, html, input.body),
      submittedAt: now,
      approvedAt: null,
      approvedBy: null,
      rejectionReason: null,
      updatedAt: now,
    }).where(and(eq(templates.id, template.id), eq(templates.workspaceId, input.workspaceId)));
    await tx.insert(auditEvents).values({
      action: "template.version_created",
      actorUserId: input.userId,
      entityId: template.id,
      entityType: "template",
      metadata: { version, previousStatus: template.reviewStatus },
      workspaceId: input.workspaceId,
    });
    return { version };
  });
}
