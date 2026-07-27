import { and, eq, gt } from "drizzle-orm";
import Stripe from "stripe";
import { requireDb } from "@/db/runtime";
import { subscriptions, usageMonths, workspaces } from "@/db/schema";
import { isPaidPlan, planCatalog } from "@/lib/plans";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("STRIPE_SECRET_KEY is missing");
  const stripe = new Stripe(secret);
  const db = requireDb();
  const month = new Date().toISOString().slice(0, 7);
  const rows = await db
    .select({
      acceptedEmails: usageMonths.acceptedEmails,
      customerId: subscriptions.stripeCustomerId,
      plan: workspaces.plan,
      reportedEmails: usageMonths.stripeReportedEmails,
      usageId: usageMonths.id,
      workspaceId: workspaces.id,
    })
    .from(usageMonths)
    .innerJoin(workspaces, eq(usageMonths.workspaceId, workspaces.id))
    .innerJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
    .where(
      and(
        eq(usageMonths.month, month),
        eq(subscriptions.status, "active"),
        gt(usageMonths.acceptedEmails, 0),
      ),
    );

  let reported = 0;
  for (const row of rows) {
    if (!row.customerId || !isPaidPlan(row.plan)) continue;
    const included = planCatalog[row.plan].includedEmails;
    const totalOverage = Math.max(0, row.acceptedEmails - included);
    const delta = totalOverage - row.reportedEmails;
    if (delta <= 0) continue;
    await stripe.billing.meterEvents.create({
      event_name: process.env.STRIPE_METER_EVENT_NAME ?? "vigiemail_emails_sent",
      identifier: `vm-${row.usageId}-${totalOverage}`,
      payload: {
        stripe_customer_id: row.customerId,
        value: String(delta),
      },
    });
    await db
      .update(usageMonths)
      .set({ stripeReportedEmails: totalOverage, updatedAt: new Date() })
      .where(
        and(
          eq(usageMonths.id, row.usageId),
          eq(usageMonths.workspaceId, row.workspaceId),
        ),
      );
    reported += delta;
  }
  return { reported };
}
