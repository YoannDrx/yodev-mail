"use server";

import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireDb } from "@/db";
import { auditEvents, stripeCheckoutAttempts, subscriptions } from "@/db/schema";
import { stripeSecretLivemode, validateStripeCatalog } from "@/features/billing/stripe-catalog";
import { stripeAutomaticTax, validateStripeTaxConfiguration } from "@/features/billing/stripe-tax";
import { type ActionState, actionFailure } from "@/lib/action-state";
import { currentWorkspace } from "@/lib/current-workspace";
import { env, isFeatureEnabled } from "@/lib/env";
import { stripe } from "@/lib/stripe";
import { localized, localizedPath, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

type BillingRefusal =
  | "checkout_closed"
  | "not_approved"
  | "catalog_missing"
  | "tax_unconfigured"
  | "catalog_invalid"
  | "billing_record_missing"
  | "already_subscribed"
  | "no_customer"
  | "unavailable";

/** A refusal the person can understand; anything else is reported as unavailable. */
class BillingRefused extends Error {
  constructor(readonly code: BillingRefusal, readonly details: string[] = []) {
    super(code);
    this.name = "BillingRefused";
  }
}

function billingCopy(locale: Locale) {
  return localized(locale, {
    fr: {
      checkout_closed: "La souscription est temporairement fermée pendant la certification de la facturation.",
      not_approved: "Le dossier doit être approuvé par Yodev avant la souscription.",
      catalog_missing: "Le catalogue Stripe privé n’est pas configuré. Contactez Yodev.",
      tax_unconfigured: "Le régime fiscal doit être certifié avant toute souscription. Contactez Yodev.",
      catalog_invalid: "La configuration de facturation est incomplète. Yodev a été prévenu ; réessayez plus tard.",
      billing_record_missing: "L’enregistrement de facturation de ce workspace est manquant. Contactez Yodev.",
      already_subscribed: "Un abonnement existe déjà pour ce workspace : gérez-le depuis le portail Stripe.",
      no_customer: "L’abonnement n’a pas encore été créé : finalisez d’abord la souscription.",
      unavailable: "Stripe est momentanément indisponible. Réessayez dans quelques minutes.",
    } satisfies Record<BillingRefusal, string>,
    en: {
      checkout_closed: "Subscriptions are temporarily closed while billing is being certified.",
      not_approved: "Yodev must approve the application before you can subscribe.",
      catalog_missing: "The private Stripe catalog is not configured. Contact Yodev.",
      tax_unconfigured: "The tax setup must be certified before any subscription. Contact Yodev.",
      catalog_invalid: "The billing configuration is incomplete. Yodev has been notified; try again later.",
      billing_record_missing: "This workspace's billing record is missing. Contact Yodev.",
      already_subscribed: "This workspace already has a subscription: manage it from the Stripe portal.",
      no_customer: "The subscription has not been created yet: complete the checkout first.",
      unavailable: "Stripe is temporarily unavailable. Try again in a few minutes.",
    } satisfies Record<BillingRefusal, string>,
  });
}

function refusalState(locale: Locale, action: string, error: unknown): ActionState {
  const code = error instanceof BillingRefused ? error.code : "unavailable";
  // Codes only: Stripe and database errors can carry customer details.
  console.error(JSON.stringify({ event: "billing_action_refused", action, code, details: error instanceof BillingRefused ? error.details : [] }));
  return actionFailure(billingCopy(locale)[code]);
}

function billingUrl(locale: Locale, query = "") {
  return `${env.NEXT_PUBLIC_APP_URL}${localizedPath(locale, "/dashboard/facturation")}${query}`;
}

function integrationIdentifier(workspaceId: string) {
  const suffix = [...createHash("sha256").update(workspaceId).digest().subarray(0, 8)]
    .map((value) => String.fromCharCode(97 + (value % 26)))
    .join("");
  return `yodevmail_${suffix}`;
}

/**
 * Opens (or resumes) the private Stripe Checkout of an approved workspace.
 * For useActionState: returns a localized refusal, or redirects to Stripe.
 */
export async function checkoutAction(): Promise<ActionState> {
  const locale = await getLocale();
  const context = await currentWorkspace({ admin: true });
  let url: string;
  try {
    url = await prepareCheckout(context, locale);
  } catch (error) {
    return refusalState(locale, "checkout", error);
  }
  redirect(url);
}

async function prepareCheckout(
  { workspace, userId }: Awaited<ReturnType<typeof currentWorkspace>>,
  locale: Locale,
): Promise<string> {
  if (!isFeatureEnabled("LIVE_CHECKOUT_ENABLED")) throw new BillingRefused("checkout_closed");
  if (workspace.status !== "approved") throw new BillingRefused("not_approved");
  if (!env.STRIPE_PRICE_PLATFORM || !env.STRIPE_PRICE_USAGE) throw new BillingRefused("catalog_missing");
  if (env.STRIPE_TAX_MODE === "unconfigured") throw new BillingRefused("tax_unconfigured");

  const stripeClient = stripe();
  if (!env.STRIPE_SECRET_KEY) throw new BillingRefused("catalog_missing");
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
  if (catalogErrors.length) throw new BillingRefused("catalog_invalid", catalogErrors);

  const db = requireDb();
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
  if (!subscription) throw new BillingRefused("billing_record_missing");
  if (["active", "trialing", "past_due"].includes(subscription.status)) throw new BillingRefused("already_subscribed");

  let attempt: typeof stripeCheckoutAttempts.$inferSelect | undefined = (await db.select().from(stripeCheckoutAttempts).where(and(
    eq(stripeCheckoutAttempts.workspaceId, workspace.id),
    eq(stripeCheckoutAttempts.status, "pending"),
  )).orderBy(desc(stripeCheckoutAttempts.createdAt)).limit(1))[0];
  if (attempt?.stripeSessionId) {
    const existingSession = await stripeClient.checkout.sessions.retrieve(attempt.stripeSessionId);
    if (existingSession.status === "open" && existingSession.url) return existingSession.url;
    await db.update(stripeCheckoutAttempts).set({
      status: existingSession.status === "complete" ? "completed" : "expired",
      completedAt: existingSession.status === "complete" ? new Date() : null,
      updatedAt: new Date(),
    }).where(and(
      eq(stripeCheckoutAttempts.id, attempt.id),
      eq(stripeCheckoutAttempts.workspaceId, workspace.id),
      eq(stripeCheckoutAttempts.status, "pending"),
    ));
    if (existingSession.status === "complete") return billingUrl(locale, "?checkout=success");
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
  if (!attempt) throw new BillingRefused("unavailable", ["checkout_attempt_not_reserved"]);
  if (!attempt.expiresAt) throw new BillingRefused("unavailable", ["checkout_expiration_missing"]);

  const metadata = { plan: "beta", workspaceId: workspace.id, yodev_product: "mail" };
  const session = await stripeClient.checkout.sessions.create({
    ...stripeAutomaticTax(env.STRIPE_TAX_MODE),
    cancel_url: billingUrl(locale, "?checkout=cancelled"),
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
    locale,
    metadata,
    mode: "subscription",
    subscription_data: { metadata },
    success_url: billingUrl(locale, "?checkout=success"),
    tax_id_collection: { enabled: true },
  }, { idempotencyKey: attempt.idempotencyKey });
  if (!session.url) throw new BillingRefused("unavailable", ["checkout_url_missing"]);

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
  return session.url;
}

/** Opens the Stripe customer portal. For useActionState, like checkoutAction. */
export async function portalAction(): Promise<ActionState> {
  const locale = await getLocale();
  const { workspace } = await currentWorkspace({ admin: true });
  let url: string;
  try {
    const [subscription] = await requireDb().select().from(subscriptions).where(eq(subscriptions.workspaceId, workspace.id)).limit(1);
    if (!subscription?.stripeCustomerId) throw new BillingRefused("no_customer");
    const session = await stripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      locale,
      return_url: billingUrl(locale),
    });
    url = session.url;
  } catch (error) {
    return refusalState(locale, "portal", error);
  }
  redirect(url);
}
