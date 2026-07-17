import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { messages } from "@/db/schema";
import { authenticateApiKey } from "@/features/api/authenticate-api-key";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const key = await authenticateApiKey(request, "emails:read");
  if (!key) return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  const { id } = await params;
  const [message] = await requireDb().select({ id: messages.id, status: messages.status, createdAt: messages.createdAt, sentAt: messages.sentAt, deliveredAt: messages.deliveredAt }).from(messages).where(and(eq(messages.id, id), eq(messages.workspaceId, key.workspaceId))).limit(1);
  return message ? NextResponse.json({ data: message }) : NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
}
