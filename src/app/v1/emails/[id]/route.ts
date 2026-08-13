import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { messages, transactionalProfiles } from "@/db/schema";
import { authenticateApiKey } from "@/features/api/authenticate-api-key";
import { consumeWorkspaceRateLimit } from "@/features/api/rate-limit";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKey(request, "emails:read");
  if (!key) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const rate = await consumeWorkspaceRateLimit(key.workspaceId, key.mode);
  if (!rate.allowed) return NextResponse.json({ error: { code: "rate_limit_exceeded" } }, { status: 429 });
  const { id } = await params;
  const [message] = await requireDb().select({
    id: messages.id,
    status: messages.status,
    category: transactionalProfiles.key,
    queuedAt: messages.queuedAt,
    acceptedAt: messages.providerAcceptedAt,
    deliveredAt: messages.deliveredAt,
    failedAt: messages.failedAt,
    ambiguousAt: messages.ambiguousAt,
    errorCode: messages.lastError,
    createdAt: messages.createdAt,
  }).from(messages).innerJoin(transactionalProfiles, and(
    eq(transactionalProfiles.id, messages.transactionalProfileId),
    eq(transactionalProfiles.workspaceId, messages.workspaceId),
  )).where(and(eq(messages.id, id), eq(messages.workspaceId, key.workspaceId))).limit(1);
  return message ? NextResponse.json({ data: message }) : NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
}
