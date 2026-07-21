"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireDb } from "@/db";
import { auditEvents, webhookEndpoints } from "@/db/schema";
import { encryptSecret, hmac } from "@/lib/crypto";
import { currentWorkspace } from "@/lib/current-workspace";
import { env } from "@/lib/env";
import { validateWebhookUrl } from "@/features/webhooks/validate-url";

const events = ["sent", "delivered", "bounced", "complained", "failed", "suppressed"] as const;
const schema = z.object({
  eventTypes: z.array(z.enum(events)).min(1),
  url: z.string().url(),
});

export type WebhookFormState = { secret: string; error: string };

export async function createWebhookFormAction(_: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  try {
    if (!env.WEBHOOK_SIGNING_SECRET) throw new Error("Chiffrement des webhooks non configuré");
    const data = schema.parse({ eventTypes: formData.getAll("eventTypes"), url: formData.get("url") });
    const url = await validateWebhookUrl(data.url);
    const { workspace, userId } = await currentWorkspace({ admin: true });
    const secret = `whsec_vm_${randomBytes(24).toString("base64url")}`;
    const [endpoint] = await requireDb().insert(webhookEndpoints).values({
      eventTypes: data.eventTypes,
      signingSecretEncrypted: encryptSecret(secret, env.WEBHOOK_SIGNING_SECRET),
      signingSecretHash: hmac(secret, env.WEBHOOK_SIGNING_SECRET),
      url,
      workspaceId: workspace.id,
    }).returning({ id: webhookEndpoints.id });
    await requireDb().insert(auditEvents).values({ action: "webhook.created", actorUserId: userId, entityId: endpoint.id, entityType: "webhook", workspaceId: workspace.id });
    revalidatePath("/dashboard/webhooks");
    return { secret, error: "" };
  } catch (error) {
    return { secret: "", error: error instanceof Error ? error.message : "Création impossible" };
  }
}

export async function toggleWebhookAction(id: string) {
  const endpointId = z.string().uuid().parse(id);
  const { workspace, userId } = await currentWorkspace({ admin: true });
  const db = requireDb();
  const [endpoint] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.workspaceId, workspace.id))).limit(1);
  if (!endpoint) throw new Error("Webhook not found");
  await db.transaction(async (tx) => {
    await tx.update(webhookEndpoints).set({ enabled: !endpoint.enabled, updatedAt: new Date() }).where(and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.workspaceId, workspace.id)));
    await tx.insert(auditEvents).values({ action: endpoint.enabled ? "webhook.disabled" : "webhook.enabled", actorUserId: userId, entityId: endpointId, entityType: "webhook", workspaceId: workspace.id });
  });
  revalidatePath("/dashboard/webhooks");
}
