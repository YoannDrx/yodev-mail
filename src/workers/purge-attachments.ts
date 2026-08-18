import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, inArray, lt, lte } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { apiRateLimits, attachments } from "@/db/schema";
import { awsClients } from "@/lib/aws";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

export async function handler() {
  await loadRuntimeSecrets();
  const bucket = process.env.ATTACHMENTS_BUCKET_NAME;
  if (!bucket) throw new Error("Attachment bucket is not configured");
  const db = requireDb();
  const expired = await db.select().from(attachments).where(and(
    lte(attachments.expiresAt, new Date()),
    inArray(attachments.status, ["pending_upload", "scanning", "clean", "rejected"]),
  )).limit(100);
  const { s3 } = await awsClients();
  for (const attachment of expired) {
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: attachment.storageKey }));
      await db.update(attachments).set({ fileName: "[expired]", status: "expired", deletedAt: new Date(), updatedAt: new Date() }).where(and(
        eq(attachments.id, attachment.id),
        eq(attachments.workspaceId, attachment.workspaceId),
        lte(attachments.expiresAt, new Date()),
        inArray(attachments.status, ["pending_upload", "scanning", "clean", "rejected"]),
      ));
    } catch (error) {
      emitOperationalMetric("AttachmentPurgeFailure");
      throw error;
    }
  }
  await db.delete(apiRateLimits).where(lt(apiRateLimits.minute, new Date(Date.now() - 24 * 3600e3)));
  return { expired: expired.length };
}
