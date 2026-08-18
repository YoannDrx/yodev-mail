import { createHash } from "node:crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, inArray } from "drizzle-orm";
import { requireDb } from "@/db/runtime";
import { attachments } from "@/db/schema";
import { awsClients } from "@/lib/aws";
import { emitOperationalMetric } from "@/lib/operational-metric";
import { loadRuntimeSecrets } from "@/workers/runtime-secrets";

type MalwareScanEvent = {
  detail?: {
    s3ObjectDetails?: { objectKey?: string };
    scanResultDetails?: { scanResultStatus?: string };
  };
};

export function detectAttachmentMime(bytes: Uint8Array, declared: string) {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  if (["text/plain", "text/csv", "application/json", "text/calendar"].includes(declared)) {
    const sample = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, Math.min(bytes.length, 4096)));
    if (/<(?:script|html|iframe|object)\b/i.test(sample)) return null;
    if (declared === "application/json") {
      try { JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
    }
    return declared;
  }
  return null;
}

export async function handler(event: MalwareScanEvent) {
  await loadRuntimeSecrets();
  const storageKey = event.detail?.s3ObjectDetails?.objectKey;
  const scanResult = event.detail?.scanResultDetails?.scanResultStatus;
  if (!storageKey || !scanResult) return;
  const db = requireDb();
  const [attachment] = await db.select().from(attachments).where(eq(attachments.storageKey, storageKey)).limit(1);
  if (!attachment) return;
  if (scanResult !== "NO_THREATS_FOUND") {
    emitOperationalMetric("AttachmentScanRejected");
    await db.update(attachments).set({ status: "rejected", scanResult, updatedAt: new Date() }).where(and(
      eq(attachments.id, attachment.id),
      eq(attachments.workspaceId, attachment.workspaceId),
      inArray(attachments.status, ["pending_upload", "scanning", "clean"]),
    ));
    return;
  }
  if (attachment.status === "clean") return;
  const [claimed] = await db.update(attachments).set({ status: "scanning", scanResult, updatedAt: new Date() }).where(and(
    eq(attachments.id, attachment.id),
    eq(attachments.workspaceId, attachment.workspaceId),
    inArray(attachments.status, ["pending_upload", "scanning"]),
  )).returning({ id: attachments.id });
  if (!claimed) return;
  const bucket = process.env.ATTACHMENTS_BUCKET_NAME;
  if (!bucket) throw new Error("Attachment bucket is not configured");
  const { s3 } = await awsClients();
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: storageKey }));
  const body = await object.Body?.transformToByteArray();
  if (!body) throw new Error("Scanned attachment cannot be read");
  const verifiedSha256 = createHash("sha256").update(body).digest("hex");
  const detectedContentType = detectAttachmentMime(body, attachment.declaredContentType);
  const clean = body.length === attachment.sizeBytes
    && verifiedSha256 === attachment.expectedSha256
    && detectedContentType === attachment.declaredContentType;
  if (!clean) emitOperationalMetric("AttachmentScanRejected");
  await db.update(attachments).set({
    detectedContentType,
    scanResult,
    status: clean ? "clean" : "rejected",
    verifiedSha256,
    updatedAt: new Date(),
  }).where(and(
    eq(attachments.id, attachment.id),
    eq(attachments.workspaceId, attachment.workspaceId),
    eq(attachments.status, "scanning"),
    eq(attachments.scanResult, "NO_THREATS_FOUND"),
  ));
}
