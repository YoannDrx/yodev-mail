"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireDb } from "@/db";
import {
  adminReviews,
  auditEvents,
  workspaceSettings,
  workspaces,
} from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";

const onboardingSchema = z.object({
  abuseAccepted: z.literal("on"),
  companyAddress: z.string().trim().min(5).max(500),
  companyName: z.string().trim().min(2).max(180),
  expectedMonthlyVolume: z.coerce.number().int().min(0).max(10_000_000),
  source: z.string().trim().min(10).max(1000),
  useCase: z.string().trim().min(20).max(2000),
  websiteUrl: z.string().url(),
});

export async function completeOnboardingAction(formData: FormData) {
  const data = onboardingSchema.parse(Object.fromEntries(formData));
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const db = requireDb();
  await db.transaction(async (tx) => {
    await tx
      .update(workspaces)
      .set({
        expectedMonthlyVolume: data.expectedMonthlyVolume,
        status: "pending_review",
        updatedAt: new Date(),
        useCase: `${data.useCase}\n\nSource des contacts : ${data.source}`,
        websiteUrl: data.websiteUrl,
      })
      .where(eq(workspaces.id, workspace.id));
    await tx
      .update(workspaceSettings)
      .set({
        abusePolicyAcceptedAt: new Date(),
        companyAddress: data.companyAddress,
        companyName: data.companyName,
        updatedAt: new Date(),
      })
      .where(eq(workspaceSettings.workspaceId, workspace.id));
    await tx
      .insert(adminReviews)
      .values({ workspaceId: workspace.id })
      .onConflictDoNothing();
    await tx.insert(auditEvents).values({
      action: "workspace.onboarding_completed",
      actorUserId: userId,
      entityId: workspace.id,
      entityType: "workspace",
      metadata: { expectedMonthlyVolume: data.expectedMonthlyVolume },
      workspaceId: workspace.id,
    });
  });
  redirect("/dashboard");
}
