import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { attachments } from "@/db/schema";
import { authenticateApiKey } from "@/features/api/authenticate-api-key";
import { consumeWorkspaceRateLimit } from "@/features/api/rate-limit";
import { readJsonBody, RequestBodyTooLargeError, UnsupportedMediaTypeError } from "@/features/api/read-json-body";
import { attachmentUploadSchema } from "@/features/emails/schema";
import { awsClients } from "@/lib/aws";
import { env, isFeatureEnabled } from "@/lib/env";

function safeFileName(value: string) {
  return value.normalize("NFKC").replace(/[\\/\0-\x1f\x7f]/g, "-").replace(/\s+/g, " ").slice(0, 180);
}

export async function POST(request: Request) {
  const key = await authenticateApiKey(request, "attachments:write");
  if (!key) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const rate = await consumeWorkspaceRateLimit(key.workspaceId, key.mode);
  if (!rate.allowed) return NextResponse.json({ error: { code: "rate_limit_exceeded" } }, { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))) } });
  if (!isFeatureEnabled("ATTACHMENTS_ENABLED") || !env.AWS_ATTACHMENTS_BUCKET) {
    return NextResponse.json({ error: { code: "attachments_unavailable" } }, { status: 503 });
  }
  let raw: unknown;
  try {
    raw = await readJsonBody(request, 16_384);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: { code: "request_too_large" } }, { status: 413 });
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return NextResponse.json({ error: { code: "unsupported_media_type" } }, { status: 415 });
    }
    throw error;
  }
  const parsed = attachmentUploadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_request", details: parsed.error.flatten() } }, { status: 422 });
  }
  const id = crypto.randomUUID();
  const storageKey = `pending/${crypto.randomUUID()}`;
  // The hourly purge gets a one-hour safety margin so storage never exceeds 24 hours.
  const expiresAt = new Date(Date.now() + 23 * 3600e3);
  const checksum = Buffer.from(parsed.data.sha256, "hex").toString("base64");
  const { s3 } = await awsClients();
  const command = new PutObjectCommand({
    Bucket: env.AWS_ATTACHMENTS_BUCKET,
    Key: storageKey,
    ContentType: parsed.data.contentType,
    ContentLength: parsed.data.sizeBytes,
    ChecksumSHA256: checksum,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 600 });
  await requireDb().insert(attachments).values({
    id,
    workspaceId: key.workspaceId,
    fileName: safeFileName(parsed.data.fileName),
    declaredContentType: parsed.data.contentType,
    sizeBytes: parsed.data.sizeBytes,
    expectedSha256: parsed.data.sha256.toLowerCase(),
    storageKey,
    expiresAt,
  });
  return NextResponse.json({
    data: {
      id,
      uploadUrl,
      requiredHeaders: {
        "content-type": parsed.data.contentType,
        "x-amz-checksum-sha256": checksum,
      },
      expiresAt: expiresAt.toISOString(),
    },
  }, { status: 201 });
}
