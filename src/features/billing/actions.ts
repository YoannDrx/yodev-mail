"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireDb } from "@/db";
import { auditEvents, subscriptions } from "@/db/schema";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";
import { stripe } from "@/lib/stripe";

function integrationIdentifier(workspaceId: string) {
  const suffix = [...createHash("sha256").update(workspaceId).digest().subarray(0, 8)]
    .map((value) => String.fromCharCode(97 + (value % 26)))
    .join("");
  return `yodevmail_${suffix}`;
}

export async function checkoutAction() {
  const { workspace, userId } = await currentWorkspace({ admin: true });
  if (workspace.status !== "approved") throw new Error("Le dossier doit être approuvé par Yodev avant la souscription.");
  if (!env.STRIPE_PRICE_PLATFORM || !env.STRIPE_PRICE_USAGE) throw new Error("Le catalogue Stripe privé n’est pas configuré.");

  const db = requireDb();
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
  if (!subscription) throw new Error("L’enregistrement de facturation est manquant.");
  if (["active", "trialing", "past_due"].includes(subscription.status)) throw new Error("Un abonnement existe déjà pour ce workspace.");

  const metadata = { plan: "beta", workspaceId: workspace.id, yodev_product: "mail" };
  const session = await stripe().checkout.sessions.create({
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation?checkout=cancelled`,
    client_reference_id: workspace.id,
    customer: subscription.stripeCustomerId ?? undefined,
    integration_identifier: integrationIdentifier(workspace.id),
    line_items: [
      { price: env.STRIPE_PRICE_PLATFORM, quantity: 1 },
      { price: env.STRIPE_PRICE_USAGE },
    ],
    metadata,
    mode: "subscription",
    subscription_data: { metadata },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation?checkout=success`,
  }, { idempotencyKey: `mail-beta-checkout:${workspace.id}` });
  if (!session.url) throw new Error("Stripe n’a pas retourné d’URL de souscription.");

  await db.insert(auditEvents).values({
    workspaceId: workspace.id,
    actorUserId: userId,
    action: "billing.private_checkout_created",
    entityType: "subscription",
    entityId: subscription.id,
  });
  redirect(session.url);
}

export async function portalAction() {
  const { workspace } = await currentWorkspace({ admin: true });
  const [subscription] = await requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
  if (!subscription?.stripeCustomerId) throw new Error("L’abonnement privé n’a pas encore été créé par Yodev.");
  const session = await stripe().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation` });
  redirect(session.url);
}
