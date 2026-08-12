"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, transactionalProfiles } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";

const profileSchema = z.object({
  key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_]{1,79}$/),
  name: z.string().trim().min(2).max(160),
  triggerDescription: z.string().trim().min(20).max(2000),
  recipientRelationship: z.string().trim().min(20).max(2000),
  expectedMonthlyVolume: z.coerce.number().int().min(1).max(10_000_000),
  contentExample: z.string().trim().min(20).max(10_000),
});

export async function createTransactionalProfileAction(formData: FormData) {
  const data = profileSchema.parse(Object.fromEntries(formData));
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const db = requireDb();
  await db.transaction(async (tx) => {
    const [profile] = await tx.insert(transactionalProfiles).values({
      workspaceId: workspace.id,
      ...data,
      status: "pending_review",
      submittedAt: new Date(),
    }).returning();
    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "transactional_profile.submitted",
      entityType: "transactional_profile",
      entityId: profile.id,
      metadata: { key: data.key, expectedMonthlyVolume: data.expectedMonthlyVolume },
    });
  });
  revalidatePath("/dashboard/profils");
}

export async function disableTransactionalProfileAction(profileId: string) {
  const id = z.string().uuid().parse(profileId);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  await requireDb().transaction(async (tx) => {
    await tx.update(transactionalProfiles).set({ status: "disabled", updatedAt: new Date() }).where(and(
      eq(transactionalProfiles.id, id),
      eq(transactionalProfiles.workspaceId, workspace.id),
    ));
    await tx.insert(auditEvents).values({ workspaceId: workspace.id, actorUserId: userId, action: "transactional_profile.disabled", entityType: "transactional_profile", entityId: id });
  });
  revalidatePath("/dashboard/profils");
}
