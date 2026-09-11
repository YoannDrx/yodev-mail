import { z } from "zod";

const schema = z.object({ workspaceId: z.string().uuid(), messageId: z.string().uuid() }).strict();

export function parseEmailSendJob(value: unknown) {
  const parsed = schema.safeParse(value);
  // Queue payloads are untrusted. Never include them in validation diagnostics.
  if (!parsed.success) throw new Error("invalid_email_send_job");
  return parsed.data;
}
