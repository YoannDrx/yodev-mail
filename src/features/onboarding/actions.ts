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
  applicationName: z.string().trim().min(2).max(180),
  averageDailyVolume: z.coerce.number().int().min(1).max(10_000_000),
  categories: z.string().trim().min(3).max(1000),
  companyAddress: z.string().trim().min(5).max(500),
  companyName: z.string().trim().min(2).max(180),
  dailyPeakVolume: z.coerce.number().int().min(1).max(10_000_000),
  domainNames: z.string().trim().min(3).max(1000),
  errorPolicy: z.string().trim().min(10).max(2000),
  exampleContent: z.string().trim().min(20).max(5000),
  expectedMonthlyVolume: z.coerce.number().int().min(0).max(10_000_000),
  noCircumvention: z.literal("on"),
  noColdEmail: z.literal("on"),
  noMarketing: z.literal("on"),
  noNewsletter: z.literal("on"),
  noPurchasedLists: z.literal("on"),
  recipientRelationship: z.string().trim().min(10).max(2000),
  suspensionAccepted: z.literal("on"),
  triggerDescription: z.string().trim().min(20).max(2000),
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
        useCase: JSON.stringify({
          applicationName: data.applicationName,
          domains: data.domainNames.split(/[\n,]/).map((value) => value.trim().toLowerCase()).filter(Boolean),
          categories: data.categories,
          triggerDescription: data.triggerDescription,
          recipientRelationship: data.recipientRelationship,
          dailyPeakVolume: data.dailyPeakVolume,
          averageDailyVolume: data.averageDailyVolume,
          exampleContent: data.exampleContent,
          errorPolicy: data.errorPolicy,
          attestations: {
            noPurchasedLists: true,
            noColdEmail: true,
            noNewsletter: true,
            noMarketing: true,
            noCircumvention: true,
            suspensionAccepted: true,
          },
        }),
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
