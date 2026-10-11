"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, webhookDeliveries, webhookEndpoints } from "@/db/schema";
import { postWebhookSafely } from "@/features/webhooks/safe-http";
import { signedWebhookHeaders } from "@/features/webhooks/sign";
import { validateWebhookUrl } from "@/features/webhooks/validate-url";
import { localized, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import {
  actionFailure,
  actionSuccess,
  fieldErrorsFromZod,
  formValues,
  type ActionState,
} from "@/lib/action-state";
import { decryptSecret, encryptSecret, secretDigest } from "@/lib/crypto";
import { currentWorkspace } from "@/lib/current-workspace";
import { env, isFeatureEnabled } from "@/lib/env";

const events = ["email.queued", "email.sent", "email.delivered", "email.soft_bounced", "email.hard_bounced", "email.complained", "email.failed", "email.suppressed"] as const;
const TEST_EVENT_INTERVAL_MS = 10_000;

export type WebhookSecretState = ActionState<{ secret: string }>;
export type WebhookTestState = ActionState<{ statusCode: number }>;

function messages(locale: Locale) {
  return localized(locale, {
    fr: {
      adminRequired: "Seuls les propriétaires et administrateurs du workspace peuvent gérer les webhooks.",
      unavailable: "Workspace indisponible. Rechargez la page puis réessayez.",
      invalidUrl: "Saisissez une URL HTTPS complète.",
      eventsRequired: "Choisissez au moins un événement.",
      encryptionMissing: "Le chiffrement des webhooks n’est pas configuré sur cet environnement.",
      urlRejected: "Cette URL est refusée : HTTPS obligatoire, sans identifiants ni port, vers des adresses publiques uniquement.",
      created: "Endpoint créé. Copiez le secret maintenant : il ne sera plus affiché.",
      invalidForm: "Vérifiez les champs signalés.",
      notFound: "Cet endpoint n’existe plus.",
      enabled: "Endpoint activé.",
      disabled: "Endpoint désactivé. Les livraisons en attente sont abandonnées.",
      deleted: "Endpoint supprimé.",
      rotated: "Nouveau secret généré. L’ancien ne signe plus aucun envoi : copiez celui-ci maintenant.",
      deliveryOff: "La livraison des webhooks est désactivée pour l’instant : aucun événement de test ne peut être envoyé.",
      tooSoon: "Un événement de test vient d’être envoyé à cet endpoint. Patientez quelques secondes.",
      testDelivered: (status: number) => `Événement de test reçu par l’endpoint (HTTP ${status}).`,
      testRejected: (status: number) => `L’endpoint a répondu HTTP ${status} : il doit répondre par un code 2xx.`,
      testUnreachable: "Connexion impossible à l’endpoint (DNS, TLS, délai de 10 s ou adresse refusée).",
    },
    en: {
      adminRequired: "Only workspace owners and administrators can manage webhooks.",
      unavailable: "Workspace unavailable. Reload the page and try again.",
      invalidUrl: "Enter a complete HTTPS URL.",
      eventsRequired: "Choose at least one event.",
      encryptionMissing: "Webhook encryption is not configured in this environment.",
      urlRejected: "This URL is refused: HTTPS only, no credentials or port, public addresses only.",
      created: "Endpoint created. Copy the secret now: it will not be shown again.",
      invalidForm: "Check the highlighted fields.",
      notFound: "This endpoint no longer exists.",
      enabled: "Endpoint enabled.",
      disabled: "Endpoint disabled. Pending deliveries are abandoned.",
      deleted: "Endpoint deleted.",
      rotated: "New secret generated. The previous one no longer signs anything: copy this one now.",
      deliveryOff: "Webhook delivery is turned off for now: no test event can be sent.",
      tooSoon: "A test event was just sent to this endpoint. Wait a few seconds.",
      testDelivered: (status: number) => `Test event received by the endpoint (HTTP ${status}).`,
      testRejected: (status: number) => `The endpoint answered HTTP ${status}: it must answer with a 2xx code.`,
      testUnreachable: "Could not reach the endpoint (DNS, TLS, 10 s timeout or refused address).",
    },
  });
}

// Authentication, administrator role and workspace ownership come first:
// nothing (not even DNS resolution) happens for an unauthorized caller.
async function authorize(copy: ReturnType<typeof messages>) {
  try {
    return { context: await currentWorkspace({ admin: true }) };
  } catch (error) {
    const adminRequired = error instanceof Error && error.message === "Workspace administrator role required.";
    return { failure: adminRequired ? copy.adminRequired : copy.unavailable };
  }
}

function newSigningSecret() {
  return `whsec_ym_${randomBytes(24).toString("base64url")}`;
}

const createSchema = (copy: ReturnType<typeof messages>) => z.object({
  eventTypes: z.array(z.enum(events), { error: copy.eventsRequired }).min(1, { error: copy.eventsRequired }),
  url: z.string({ error: copy.invalidUrl }).trim().url({ error: copy.invalidUrl }).max(2_048, { error: copy.invalidUrl }),
});

export async function createWebhookFormAction(_: WebhookSecretState, formData: FormData): Promise<WebhookSecretState> {
  const copy = messages(await getLocale());
  const values = { ...formValues(formData, ["url"]), eventTypes: formData.getAll("eventTypes").filter((item) => typeof item === "string").join(",") };
  const auth = await authorize(copy);
  if (!auth.context) return actionFailure(auth.failure, { values });
  const parsed = createSchema(copy).safeParse({ eventTypes: formData.getAll("eventTypes"), url: formData.get("url") });
  if (!parsed.success) return actionFailure(copy.invalidForm, { fieldErrors: fieldErrorsFromZod(parsed.error), values });
  const encryptionKey = env.WEBHOOK_SIGNING_SECRET;
  if (!encryptionKey) return actionFailure(copy.encryptionMissing, { values });
  let url: string;
  try {
    url = await validateWebhookUrl(parsed.data.url);
  } catch {
    return actionFailure(copy.invalidForm, { fieldErrors: { url: [copy.urlRejected] }, values });
  }
  const { workspace, userId } = auth.context;
  const secret = newSigningSecret();
  await requireDb().transaction(async (tx) => {
    const [endpoint] = await tx.insert(webhookEndpoints).values({
      eventTypes: parsed.data.eventTypes,
      signingSecretEncrypted: encryptSecret(secret, encryptionKey),
      signingSecretHash: secretDigest(secret, encryptionKey),
      url,
      workspaceId: workspace.id,
    }).returning({ id: webhookEndpoints.id });
    await tx.insert(auditEvents).values({ action: "webhook.created", actorUserId: userId, entityId: endpoint.id, entityType: "webhook", workspaceId: workspace.id });
  });
  revalidatePath("/dashboard/webhooks");
  return actionSuccess(copy.created, { secret });
}

function endpointId(formData: FormData) {
  const parsed = z.string().uuid().safeParse(formData.get("endpointId"));
  return parsed.success ? parsed.data : null;
}

export async function toggleWebhookAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const copy = messages(await getLocale());
  const auth = await authorize(copy);
  if (!auth.context) return actionFailure(auth.failure);
  const id = endpointId(formData);
  if (!id) return actionFailure(copy.notFound);
  const { workspace, userId } = auth.context;
  const result = await requireDb().transaction(async (tx) => {
    await tx.execute(sql`select ${webhookEndpoints.id} from ${webhookEndpoints} where ${webhookEndpoints.id} = ${id} and ${webhookEndpoints.workspaceId} = ${workspace.id} for update`);
    const [endpoint] = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspace.id))).limit(1);
    if (!endpoint) return null;
    const now = new Date();
    await tx.update(webhookEndpoints).set({ enabled: !endpoint.enabled, updatedAt: now }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspace.id)));
    if (endpoint.enabled) {
      await tx.update(webhookDeliveries).set({
        claimedAt: null,
        lastError: "endpoint_disabled",
        nextAttemptAt: null,
        terminalAt: now,
        updatedAt: now,
      }).where(and(
        eq(webhookDeliveries.endpointId, id),
        eq(webhookDeliveries.workspaceId, workspace.id),
        isNull(webhookDeliveries.deliveredAt),
        isNull(webhookDeliveries.terminalAt),
      ));
    }
    await tx.insert(auditEvents).values({ action: endpoint.enabled ? "webhook.disabled" : "webhook.enabled", actorUserId: userId, entityId: id, entityType: "webhook", workspaceId: workspace.id });
    return { enabled: !endpoint.enabled };
  });
  if (!result) return actionFailure(copy.notFound);
  revalidatePath("/dashboard/webhooks");
  return actionSuccess(result.enabled ? copy.enabled : copy.disabled);
}

export async function deleteWebhookAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const copy = messages(await getLocale());
  const auth = await authorize(copy);
  if (!auth.context) return actionFailure(auth.failure);
  const id = endpointId(formData);
  if (!id) return actionFailure(copy.notFound);
  const { workspace, userId } = auth.context;
  // Pending deliveries cascade with the endpoint; a queued job for one of
  // them finds nothing and ends without sending.
  const deleted = await requireDb().transaction(async (tx) => {
    const [endpoint] = await tx.delete(webhookEndpoints)
      .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspace.id)))
      .returning({ id: webhookEndpoints.id });
    if (!endpoint) return false;
    await tx.insert(auditEvents).values({ action: "webhook.deleted", actorUserId: userId, entityId: id, entityType: "webhook", workspaceId: workspace.id });
    return true;
  });
  if (!deleted) return actionFailure(copy.notFound);
  revalidatePath("/dashboard/webhooks");
  return actionSuccess(copy.deleted);
}

export async function rotateWebhookSecretAction(_: WebhookSecretState, formData: FormData): Promise<WebhookSecretState> {
  const copy = messages(await getLocale());
  const auth = await authorize(copy);
  if (!auth.context) return actionFailure(auth.failure);
  const id = endpointId(formData);
  if (!id) return actionFailure(copy.notFound);
  const encryptionKey = env.WEBHOOK_SIGNING_SECRET;
  if (!encryptionKey) return actionFailure(copy.encryptionMissing);
  const { workspace, userId } = auth.context;
  const secret = newSigningSecret();
  const rotated = await requireDb().transaction(async (tx) => {
    const [endpoint] = await tx.update(webhookEndpoints).set({
      signingSecretEncrypted: encryptSecret(secret, encryptionKey),
      signingSecretHash: secretDigest(secret, encryptionKey),
      updatedAt: new Date(),
    }).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspace.id)))
      .returning({ id: webhookEndpoints.id });
    if (!endpoint) return false;
    await tx.insert(auditEvents).values({ action: "webhook.secret_rotated", actorUserId: userId, entityId: id, entityType: "webhook", workspaceId: workspace.id });
    return true;
  });
  if (!rotated) return actionFailure(copy.notFound);
  return actionSuccess(copy.rotated, { secret });
}

export async function sendWebhookTestAction(_: WebhookTestState, formData: FormData): Promise<WebhookTestState> {
  const copy = messages(await getLocale());
  const auth = await authorize(copy);
  if (!auth.context) return actionFailure(auth.failure);
  const id = endpointId(formData);
  if (!id) return actionFailure(copy.notFound);
  // Same fail-closed gate as real deliveries: no outbound call while closed.
  if (!isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED")) return actionFailure(copy.deliveryOff);
  const encryptionKey = env.WEBHOOK_SIGNING_SECRET;
  if (!encryptionKey) return actionFailure(copy.encryptionMissing);
  const { workspace, userId } = auth.context;
  const db = requireDb();
  const [endpoint] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.workspaceId, workspace.id))).limit(1);
  if (!endpoint) return actionFailure(copy.notFound);
  const now = new Date();
  const [recent] = await db.select({ id: auditEvents.id }).from(auditEvents).where(and(
    eq(auditEvents.workspaceId, workspace.id),
    eq(auditEvents.action, "webhook.tested"),
    eq(auditEvents.entityId, id),
    gt(auditEvents.createdAt, new Date(now.getTime() - TEST_EVENT_INTERVAL_MS)),
  )).limit(1);
  if (recent) return actionFailure(copy.tooSoon);
  await db.insert(auditEvents).values({ action: "webhook.tested", actorUserId: userId, entityId: id, entityType: "webhook", workspaceId: workspace.id });

  // Same envelope and signature as real events; only Yodev identifiers.
  const body = JSON.stringify({
    created_at: now.toISOString(),
    data: { message_id: null },
    id: randomUUID(),
    type: "webhook.test",
  });
  let statusCode: number;
  try {
    const url = await validateWebhookUrl(endpoint.url);
    const signingSecret = decryptSecret(endpoint.signingSecretEncrypted, encryptionKey);
    statusCode = await postWebhookSafely({ url, body, headers: signedWebhookHeaders(body, signingSecret, now), timeoutMs: 10_000 });
  } catch {
    return actionFailure(copy.testUnreachable);
  }
  if (statusCode < 200 || statusCode >= 300) return actionFailure(copy.testRejected(statusCode));
  return actionSuccess(copy.testDelivered(statusCode), { statusCode });
}
