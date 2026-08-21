"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireDb } from "@/db";
import { auditEvents, stripeCheckoutAttempts, subscriptions } from "@/db/schema";
import { stripeSecretLivemode, validateStripeCatalog } from "@/features/billing/stripe-catalog";
import { stripeAutomaticTax, validateStripeTaxConfiguration } from "@/features/billing/stripe-tax";
import { currentWorkspace } from "@/lib/current-workspace";
import { env, isFeatureEnabled } from "@/lib/env";
import { stripe } from "@/lib/stripe";

function integrationIdentifier(workspaceId: string) {
  const suffix = [...createHash("sha256").update(workspaceId).digest().subarray(0, 8)]
    .map((value) => String.fromCharCode(97 + (value % 26)))
    .join("");
  return `yodevmail_${suffix}`;
}

export async function checkoutAction() {
  if (!isFeatureEnabled("LIVE_CHECKOUT_ENABLED")) {
    throw new Error("La souscription est temporairement fermée pendant la certification de facturation.");
  }
  const { workspace, userId } = await currentWorkspace({ admin: true });
  if (workspace.status !== "approved") throw new Error("Le dossier doit être approuvé par Yodev avant la souscription.");
  if (!env.STRIPE_PRICE_PLATFORM || !env.STRIPE_PRICE_USAGE) throw new Error("Le catalogue Stripe privé n’est pas configuré.");
  if (env.STRIPE_TAX_MODE === "unconfigured") {
    throw new Error("Le régime fiscal Stripe doit être certifié avant toute souscription.");
  }

  const stripeClient = stripe();
  if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe secret key is not configured.");
  const expectedLivemode = stripeSecretLivemode(env.STRIPE_SECRET_KEY);
  const [platformPrice, usagePrice, registrations] = await Promise.all([
    stripeClient.prices.retrieve(env.STRIPE_PRICE_PLATFORM),
    stripeClient.prices.retrieve(env.STRIPE_PRICE_USAGE),
    stripeClient.tax.registrations.list({ limit: 100, status: "active" }),
  ]);
  const catalogErrors = validateStripeCatalog({
    expectedLivemode,
    platform: platformPrice,
    usage: usagePrice,
  });
  catalogErrors.push(...validateStripeTaxConfiguration({
    activeRegistrationCountries: registrations.data.map((registration) => registration.country),
    mode: env.STRIPE_TAX_MODE,
  }));
  const meterId = usagePrice.recurring?.meter;
  if (meterId) {
    const meter = await stripeClient.billing.meters.retrieve(meterId);
    if (meter.event_name !== env.STRIPE_METER_EVENT_NAME) catalogErrors.push("usage_meter_event_invalid");
  }
  if (catalogErrors.length) throw new Error(`Stripe catalog is invalid: ${catalogErrors.join(",")}`);

  const db = requireDb();
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
  if (!subscription) throw new Error("L’enregistrement de facturation est manquant.");
  if (["active", "trialing", "past_due"].includes(subscription.status)) throw new Error("Un abonnement existe déjà pour ce workspace.");

  let attempt: typeof stripeCheckoutAttempts.$inferSelect | undefined = (await db.select().from(stripeCheckoutAttempts).where(and(
    eq(stripeCheckoutAttempts.workspaceId, workspace.id),
    eq(stripeCheckoutAttempts.status, "pending"),
  )).orderBy(desc(stripeCheckoutAttempts.createdAt)).limit(1))[0];
  if (attempt?.stripeSessionId) {
    const existingSession = await stripeClient.checkout.sessions.retrieve(attempt.stripeSessionId);
    if (existingSession.status === "open" && existingSession.url) redirect(existingSession.url);
    await db.update(stripeCheckoutAttempts).set({
      status: existingSession.status === "complete" ? "completed" : "expired",
      completedAt: existingSession.status === "complete" ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(
      eq(stripeCheckoutAttempts.id, attempt.id),
      eq(stripeCheckoutAttempts.workspaceId, workspace.id),
      eq(stripeCheckoutAttempts.status, "pending"),
    ));
    if (existingSession.status === "complete") {
      redirect(`${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation?checkout=success`);
    }
    attempt = undefined;
  }

  if (!attempt) {
    const attemptId = crypto.randomUUID();
    await db.insert(stripeCheckoutAttempts).values({
      id: attemptId,
      workspaceId: workspace.id,
      subscriptionId: subscription.id,
      stripeCustomerId: subscription.stripeCustomerId,
      platformPriceId: env.STRIPE_PRICE_PLATFORM,
      usagePriceId: env.STRIPE_PRICE_USAGE,
      idempotencyKey: `mail-beta-checkout:${attemptId}`,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    }).onConflictDoNothing();
    attempt = (await db.select().from(stripeCheckoutAttempts).where(and(
      eq(stripeCheckoutAttempts.workspaceId, workspace.id),
      eq(stripeCheckoutAttempts.status, "pending"),
    )).orderBy(desc(stripeCheckoutAttempts.createdAt)).limit(1))[0];
  }
  if (!attempt) throw new Error("Unable to reserve a Stripe checkout attempt.");
  if (!attempt.expiresAt) throw new Error("The Stripe checkout expiration is missing.");

  const metadata = { plan: "beta", workspaceId: workspace.id, yodev_product: "mail" };
  const session = await stripeClient.checkout.sessions.create({
    ...stripeAutomaticTax(env.STRIPE_TAX_MODE),
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation?checkout=cancelled`,
    client_reference_id: workspace.id,
    consent_collection: { terms_of_service: "required" },
    customer: attempt.stripeCustomerId ?? undefined,
    customer_update: attempt.stripeCustomerId ? { address: "auto", name: "auto" } : undefined,
    expires_at: Math.floor(attempt.expiresAt.getTime() / 1_000),
    integration_identifier: integrationIdentifier(workspace.id),
    line_items: [
      { price: attempt.platformPriceId, quantity: 1 },
      { price: attempt.usagePriceId },
    ],
    locale: "fr",
    metadata,
    mode: "subscription",
    subscription_data: { metadata },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation?checkout=success`,
    tax_id_collection: { enabled: true },
  }, { idempotencyKey: attempt.idempotencyKey });
  if (!session.url) throw new Error("Stripe n’a pas retourné d’URL de souscription.");

  const stored = await db.update(stripeCheckoutAttempts).set({
    stripeSessionId: session.id,
    expiresAt: new Date(session.expires_at * 1_000),
    updatedAt: new Date(),
  }).where(and(
    eq(stripeCheckoutAttempts.id, attempt.id),
    eq(stripeCheckoutAttempts.workspaceId, workspace.id),
    isNull(stripeCheckoutAttempts.stripeSessionId),
  )).returning({ id: stripeCheckoutAttempts.id });
  if (stored.length) {
    await db.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      action: "billing.private_checkout_created",
      entityType: "stripe_checkout_attempt",
      entityId: attempt.id,
    });
  }
  redirect(session.url);
}

export async function portalAction() {
  const { workspace } = await currentWorkspace({ admin: true });
  const [subscription] = await requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
  if (!subscription?.stripeCustomerId) throw new Error("L’abonnement privé n’a pas encore été créé par Yodev.");
  const session = await stripe().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard/facturation` });
  redirect(session.url);
}
