import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { idempotencyKeys } from "@/db/schema";
import { authenticateApiKey } from "@/features/api/authenticate-api-key";
import { readJsonBody, RequestBodyTooLargeError, UnsupportedMediaTypeError } from "@/features/api/read-json-body";
import { consumeWorkspaceRateLimit } from "@/features/api/rate-limit";
import { withSafeRouteErrors } from "@/features/api/safe-route";
import { acceptEmail } from "@/features/emails/accept";
import { isFeatureEnabled } from "@/lib/env";

async function postEmail(request: Request) {
  const key = await authenticateApiKey(request, "emails:send");
  if (!key) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Clé API invalide ou scope manquant." } }, { status: 401 });
  }
  if (key.mode === "live" && !isFeatureEnabled("LIVE_EMAIL_ACCEPTANCE_ENABLED")) {
    return NextResponse.json({ error: { code: "live_email_acceptance_disabled", message: "Les envois live sont temporairement suspendus." } }, { status: 503 });
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return NextResponse.json({ error: { code: "idempotency_key_required", message: "L’en-tête Idempotency-Key est requis." } }, { status: 400 });
  }
  const db = requireDb();
  // A retry of an already accepted request must not burn the per-minute
  // budget, otherwise legitimate client retries end up rate limited. Only a
  // key that already exists for this workspace skips the limiter, and that
  // path can only replay the stored answer or refuse a different body: it
  // never creates a message, so it cannot be used to bypass the limit.
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, key.workspaceId), eq(idempotencyKeys.key, idempotencyKey)))
    .limit(1);
  if (!existing) {
    const rate = await consumeWorkspaceRateLimit(key.workspaceId, key.mode);
    if (!rate.allowed) {
      return NextResponse.json({ error: { code: "rate_limit_exceeded" } }, {
        status: 429,
        headers: { "retry-after": String(Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))), "x-ratelimit-limit": String(rate.limit), "x-ratelimit-remaining": "0" },
      });
    }
  }
  let raw: unknown;
  try {
    raw = await readJsonBody(request, 1_048_576);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json({ error: { code: "request_too_large" } }, { status: 413 });
    }
    if (error instanceof UnsupportedMediaTypeError) {
      return NextResponse.json({ error: { code: "unsupported_media_type" } }, { status: 415 });
    }
    throw error;
  }
  const result = await acceptEmail({
    workspaceId: key.workspaceId,
    mode: key.mode,
    scopes: key.scopes,
    idempotencyKey,
    existing,
    raw,
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const POST = withSafeRouteErrors(postEmail);
