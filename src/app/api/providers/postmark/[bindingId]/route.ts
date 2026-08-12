import { timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { domainProviderBindings, workspaceProviderAccounts } from "@/db/schema";
import { ingestProviderEvent } from "@/features/providers/ingest-event";
import { normalizePostmarkEvent, parsePostmarkWebhook } from "@/features/providers/postmark-events";
import { enqueueProviderEvent } from "@/lib/aws";
import { getSecureParameter } from "@/workers/runtime-secrets";

const MAX_BODY_BYTES = 64 * 1024;
const POSTMARK_WEBHOOK_IPS = new Set(["3.134.147.250", "50.31.156.6", "50.31.156.77", "18.217.206.57"]);

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request, { params }: { params: Promise<{ bindingId: string }> }) {
  const sourceIp = (request.headers.get("x-vercel-forwarded-for") ?? request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  if (process.env.VERCEL_ENV === "production" && !POSTMARK_WEBHOOK_IPS.has(sourceIp)) return new NextResponse(null, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  const { bindingId } = await params;
  const db = requireDb();
  const [binding] = await db.select().from(domainProviderBindings).where(and(
    eq(domainProviderBindings.id, bindingId),
    eq(domainProviderBindings.provider, "postmark"),
  )).limit(1);
  if (!binding) return new NextResponse(null, { status: 403 });
  const [account] = await db.select().from(workspaceProviderAccounts).where(and(
    eq(workspaceProviderAccounts.workspaceId, binding.workspaceId),
    eq(workspaceProviderAccounts.provider, "postmark"),
  )).limit(1);
  if (!account?.credentialParameterName || !account.externalAccountId) return new NextResponse(null, { status: 403 });
  const webhookPassword = await getSecureParameter(`${account.credentialParameterName.replace(/\/server-token$/, "")}/webhook-password`);
  const authorization = request.headers.get("authorization") ?? "";
  const expected = `Basic ${Buffer.from(`yodev-mail:${webhookPassword}`).toString("base64")}`;
  if (!equal(authorization, expected)) return new NextResponse(null, { status: 403 });
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new NextResponse(null, { status: 413 });
  let payload: ReturnType<typeof parsePostmarkWebhook>;
  try { payload = parsePostmarkWebhook(JSON.parse(raw)); }
  catch { return new NextResponse(null, { status: 400 }); }
  if (String(payload.ServerID ?? "") !== account.externalAccountId) return new NextResponse(null, { status: 403 });
  const event = normalizePostmarkEvent(payload);
  if (event) {
    const queued = await enqueueProviderEvent({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    });
    if (queued.local) await ingestProviderEvent(event);
  }
  return NextResponse.json({ ok: true });
}
