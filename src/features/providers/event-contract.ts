import { z } from "zod";

// Accept UUIDs already stored by the application, including synthetic fixtures.
export const eventWorkspaceId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
export const eventOpaqueId = z.string().min(1).max(180).regex(/^[a-z0-9:_-]+$/i);
export const eventTimestamp = z.string().datetime({ offset: true });

// Never propagate a provider's arbitrary diagnostic text into a queue or event.
const reasonCodes = new Set([
  "Permanent", "Transient", "Undetermined", "HardBounce", "SoftBounce", "SpamComplaint",
]);
export function safeEventReason(value: unknown): string | undefined {
  return typeof value === "string" && reasonCodes.has(value) ? value : undefined;
}
