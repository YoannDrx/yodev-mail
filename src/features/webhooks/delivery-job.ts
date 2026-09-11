import { z } from "zod";

const schema = z.object({ workspaceId: z.string().uuid(), deliveryId: z.string().uuid() }).strict();

export function parseWebhookDeliveryJob(value: unknown) {
  const parsed = schema.safeParse(value);
  // Queue payloads are untrusted. Never include them in validation diagnostics.
  if (!parsed.success) throw new Error("invalid_webhook_delivery_job");
  return parsed.data;
}
