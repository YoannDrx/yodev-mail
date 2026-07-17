import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import { domains, idempotencyKeys, messages, templateVersions } from "@/db/schema";
import { authenticateApiKey } from "@/features/api/authenticate-api-key";
import { sendEmailSchema } from "@/features/emails/schema";
import { enqueueMessages } from "@/lib/aws";
import { sha256 } from "@/lib/crypto";

export async function POST(request: Request) {
  const key = await authenticateApiKey(request, "emails:send");
  if (!key) return NextResponse.json({ error: { code: "unauthorized", message: "Clé API invalide ou scope manquant." } }, { status: 401 });
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) return NextResponse.json({ error: { code: "idempotency_key_required", message: "L'en-tête Idempotency-Key est requis." } }, { status: 400 });
  const raw = await request.json().catch(() => null);
  const parsed = sendEmailSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: { code: "invalid_request", details: parsed.error.flatten() } }, { status: 422 });
  const db = requireDb();
  const requestHash = sha256(JSON.stringify(parsed.data));
  const [existing] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.workspaceId, key.workspaceId), eq(idempotencyKeys.key, idempotencyKey))).limit(1);
  if (existing) return existing.requestHash === requestHash ? NextResponse.json({ data: existing.response.ids.map(id => ({ id, status: "queued" })) }, { status: 202 }) : NextResponse.json({ error: { code: "idempotency_conflict", message: "Cette clé a déjà été utilisée avec un corps différent." } }, { status: 409 });
  const domainName = parsed.data.from.email.split("@").at(-1)!;
  const [domain] = await db.select().from(domains).where(and(eq(domains.workspaceId, key.workspaceId), eq(domains.name, domainName), eq(domains.status, "verified"))).limit(1);
  if (!domain) return NextResponse.json({ error: { code: "domain_not_verified", message: "Le domaine expéditeur n'est pas vérifié." } }, { status: 403 });
  let html: string; let plainText: string;
  if (parsed.data.html !== undefined && parsed.data.text !== undefined) { html = parsed.data.html; plainText = parsed.data.text; }
  else {
    const templateId = parsed.data.templateId!;
    const variables = parsed.data.variables ?? {};
    const [version] = await db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId)).orderBy(templateVersions.version).limit(1);
    if (!version) return NextResponse.json({ error: { code: "template_not_found" } }, { status: 404 });
    const replace = (value: string) => value.replace(/{{\s*([\w.]+)\s*}}/g, (_, name: string) => String(variables[name] ?? ""));
    html = replace(version.html); plainText = replace(version.plainText);
  }
  const ids = parsed.data.to.map(() => crypto.randomUUID());
  await db.transaction(async tx => {
    await tx.insert(messages).values(parsed.data.to.map((recipient, index) => ({ id: ids[index], workspaceId: key.workspaceId, domainId: domain.id, stream: "transactional" as const, fromEmail: parsed.data.from.email, fromName: parsed.data.from.name, toEmail: recipient.email, toName: recipient.name, replyTo: parsed.data.replyTo, subject: parsed.data.subject, html, plainText, tags: parsed.data.tags, trackingOpens: parsed.data.tracking.opens, trackingClicks: parsed.data.tracking.clicks, requestHash, contentExpiresAt: new Date(Date.now() + 30 * 864e5) })));
    await tx.insert(idempotencyKeys).values({ workspaceId: key.workspaceId, key: idempotencyKey, requestHash, response: { ids } });
  });
  await enqueueMessages(ids);
  return NextResponse.json({ data: ids.map(id => ({ id, status: "queued" })) }, { status: 202 });
}
