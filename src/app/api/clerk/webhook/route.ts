import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { requireDb } from "@/db";
import { subscriptions, workspaceSettings, workspaces } from "@/db/schema";

export async function POST(request: NextRequest) {
  let event;
  try { event = await verifyWebhook(request); }
  catch { return NextResponse.json({ error: "Invalid signature" }, { status: 400 }); }
  const db = requireDb();
  if (event.type === "organization.created") {
    const data = event.data;
    await db.transaction(async (tx) => {
      const [workspace] = await tx.insert(workspaces).values({ clerkOrganizationId: data.id, ownerUserId: data.created_by ?? "unknown", name: data.name, slug: data.slug ?? data.id, status: "sandbox", dailyLimit: 50 }).onConflictDoNothing().returning();
      const current = workspace ?? await tx.select().from(workspaces).where(eq(workspaces.clerkOrganizationId, data.id)).limit(1).then((rows) => rows[0]);
      if (current) {
        await tx.insert(workspaceSettings).values({ workspaceId: current.id }).onConflictDoNothing();
        await tx.insert(subscriptions).values({ workspaceId: current.id }).onConflictDoNothing();
      }
    });
  }
  if (event.type === "organization.updated") await db.update(workspaces).set({ name: event.data.name, slug: event.data.slug ?? event.data.id, updatedAt: new Date() }).where(eq(workspaces.clerkOrganizationId, event.data.id));
  if (event.type === "organization.deleted" && event.data.id) await db.update(workspaces).set({ deletedAt: new Date(), status: "paused", updatedAt: new Date() }).where(eq(workspaces.clerkOrganizationId, event.data.id));
  return NextResponse.json({ received: true });
}
