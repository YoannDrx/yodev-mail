import { z } from "zod";

const schema = z.object({ workspaceId: z.string().uuid(), bindingId: z.string().uuid() }).strict();

export function parseProvisioningJob(value: unknown) {
  const parsed = schema.safeParse(value);
  // Do not propagate a validation error containing an untrusted queue body.
  if (!parsed.success) throw new Error("invalid_provider_provisioning_job");
  return parsed.data;
}
