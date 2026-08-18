import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireDb } from "@/db";
import {
  attachments,
  domains,
  emailEvents,
  idempotencyKeys,
  messages,
  outboxJobs,
  templates,
  templateVersions,
  transactionalProfiles,
  usageDays,
  webhookDeliveries,
  webhookEndpoints,
  workspaces,
} from "@/db/schema";
import { authenticateApiKey } from "@/features/api/authenticate-api-key";
import { readJsonBody, RequestBodyTooLargeError, UnsupportedMediaTypeError } from "@/features/api/read-json-body";
import { consumeWorkspaceRateLimit } from "@/features/api/rate-limit";
import { normalizeEmail } from "@/features/email-address/normalization";
import { combinedContentSize, estimatedMimeSize, isRawContent, sendEmailSchema } from "@/features/emails/schema";
import { evaluateStoredMessage, utcDay } from "@/features/sending/eligibility";
import { renderApprovedTemplate, TemplateVariablesMissingError } from "@/features/templates/render";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { isFeatureEnabled } from "@/lib/env";

function databaseErrorCode(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!current || typeof current !== "object") return undefined;
    const candidate = current as { cause?: unknown; code?: unknown };
    if (typeof candidate.code === "string") return candidate.code;
    current = candidate.cause;
  }
  return undefined;
}

export async function POST(request: Request) {
  const key = await authenticateApiKey(request, "emails:send");
  if (!key) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Clé API invalide ou scope manquant." } }, { status: 401 });
  }
  if (key.mode === "live" && !isFeatureEnabled("LIVE_EMAIL_ACCEPTANCE_ENABLED")) {
    return NextResponse.json({ error: { code: "live_email_acceptance_disabled", message: "Les envois live sont temporairement suspendus." } }, { status: 503 });
  }
  const rate = await consumeWorkspaceRateLimit(key.workspaceId, key.mode);
  if (!rate.allowed) {
    return NextResponse.json({ error: { code: "rate_limit_exceeded" } }, {
      status: 429,
      headers: { "retry-after": String(Math.max(1, Math.ceil((rate.resetAt.getTime() - Date.now()) / 1000))), "x-ratelimit-limit": String(rate.limit), "x-ratelimit-remaining": "0" },
    });
  }
  const idempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!idempotencyKey || idempotencyKey.length > 128) {
    return NextResponse.json({ error: { code: "idempotency_key_required", message: "L’en-tête Idempotency-Key est requis." } }, { status: 400 });
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
  const parsed = sendEmailSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "invalid_request", details: parsed.error.flatten() } }, { status: 422 });
  }
  if (parsed.data.attachments.length && !isFeatureEnabled("ATTACHMENTS_ENABLED")) {
    return NextResponse.json(
      { error: { code: "attachments_unavailable", message: "Les pièces jointes sont temporairement désactivées." } },
      { status: 503 },
    );
  }

  const db = requireDb();
  const requestHash = sha256(canonicalJson(parsed.data));
  const fromEmail = normalizeEmail(parsed.data.from.email);
  const toEmail = normalizeEmail(parsed.data.to.email);
  const replyTo = parsed.data.replyTo
    ? normalizeEmail(parsed.data.replyTo)
    : undefined;
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, key.workspaceId), eq(idempotencyKeys.key, idempotencyKey)))
    .limit(1);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return NextResponse.json({ error: { code: "idempotency_conflict", message: "Cette clé a déjà été utilisée avec un corps différent." } }, { status: 409 });
    }
    const [message] = await db
      .select({ id: messages.id, status: messages.status })
      .from(messages)
      .where(and(eq(messages.id, existing.response.ids[0]), eq(messages.workspaceId, key.workspaceId)))
      .limit(1);
    return NextResponse.json({ data: message ?? { id: existing.response.ids[0], status: "queued" } }, { status: 202 });
  }

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, key.workspaceId)).limit(1);
  if (!workspace) return NextResponse.json({ error: { code: "workspace_not_found" } }, { status: 404 });

  const domainName = fromEmail.split("@").at(-1)!;
  const availableDomains = await db
    .select()
    .from(domains)
    .where(and(eq(domains.workspaceId, key.workspaceId), eq(domains.status, "verified")));
  const domain = availableDomains
    .filter((candidate) => domainName === candidate.name || domainName.endsWith(`.${candidate.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (!domain?.activeProvider) {
    return NextResponse.json({ error: { code: "domain_not_ready", message: "Le domaine expéditeur n’a aucun service de livraison actif." } }, { status: 403 });
  }

  const [profile] = await db
    .select()
    .from(transactionalProfiles)
    .where(and(
      eq(transactionalProfiles.workspaceId, key.workspaceId),
      eq(transactionalProfiles.key, parsed.data.category),
      eq(transactionalProfiles.status, "approved"),
    ))
    .limit(1);
  if (!profile) {
    return NextResponse.json({ error: { code: "transactional_profile_not_approved", message: "Le cas d’usage transactionnel n’est pas approuvé." } }, { status: 403 });
  }

  let subject: string;
  let html: string;
  let plainText: string;
  let contentKind: "template" | "raw";
  if (isRawContent(parsed.data.content)) {
    if (!isFeatureEnabled("RAW_EMAIL_ENABLED") || workspace.contentPolicy !== "hybrid" || !key.scopes.includes("emails:send:raw")) {
      return NextResponse.json({ error: { code: "raw_content_forbidden", message: "Cette clé ne peut envoyer que des templates approuvés." } }, { status: 403 });
    }
    ({ subject, html, text: plainText } = parsed.data.content);
    contentKind = "raw";
  } else {
    const [version] = await db
      .select({
        subject: templates.subject,
        html: templateVersions.html,
        plainText: templateVersions.plainText,
      })
      .from(templateVersions)
      .innerJoin(templates, eq(templateVersions.templateId, templates.id))
      .where(and(
        eq(templates.id, parsed.data.content.templateId),
        eq(templates.workspaceId, key.workspaceId),
        eq(templates.transactionalProfileId, profile.id),
        eq(templates.reviewStatus, "approved"),
        eq(templateVersions.workspaceId, key.workspaceId),
      ))
      .orderBy(desc(templateVersions.version))
      .limit(1);
    if (!version) return NextResponse.json({ error: { code: "template_not_approved" } }, { status: 404 });
    try {
      ({ subject, html, plainText } = renderApprovedTemplate({
        subject: version.subject,
        html: version.html,
        plainText: version.plainText,
        variables: parsed.data.content.variables,
      }));
    } catch (error) {
      if (error instanceof TemplateVariablesMissingError) {
        return NextResponse.json({ error: { code: "template_variables_missing", details: { missing: error.missingVariables } } }, { status: 422 });
      }
      throw error;
    }
    contentKind = "template";
  }

  subject = subject.replace(/[\r\n]+/g, " ").trim();

  const attachmentIds = parsed.data.attachments.map((attachment) => attachment.id);
  const contentBytes = combinedContentSize(html, plainText);
  if (contentBytes > 512_000) {
    return NextResponse.json({ error: { code: "content_too_large" } }, { status: 422 });
  }
  const attachmentRows = attachmentIds.length
    ? await db.select().from(attachments).where(and(
        eq(attachments.workspaceId, key.workspaceId),
        inArray(attachments.id, attachmentIds),
        eq(attachments.status, "clean"),
        gt(attachments.expiresAt, new Date()),
        isNull(attachments.messageId),
      ))
    : [];
  if (attachmentRows.length !== attachmentIds.length || new Set(attachmentRows.map((row) => row.id)).size !== attachmentIds.length) {
    return NextResponse.json({ error: { code: "attachment_not_ready", message: "Une pièce jointe est absente, expirée, déjà utilisée ou non validée." } }, { status: 409 });
  }
  const attachmentBytes = attachmentRows.reduce((total, attachment) => total + attachment.sizeBytes, 0);
  if (attachmentBytes > 6 * 1024 * 1024) {
    return NextResponse.json({ error: { code: "attachments_too_large" } }, { status: 422 });
  }
  if (estimatedMimeSize(contentBytes, attachmentBytes, attachmentRows.length) >= 9 * 1024 * 1024) {
    return NextResponse.json({ error: { code: "message_too_large" } }, { status: 422 });
  }

  const eligibility = await evaluateStoredMessage(db, {
    domainId: domain.id,
    mode: key.mode,
    profileId: profile.id,
    provider: domain.activeProvider,
    toEmail,
    workspaceId: key.workspaceId,
  });
  if (!eligibility.allowed) {
    return NextResponse.json({ error: { code: eligibility.code, message: eligibility.reason } }, { status: 403 });
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const simulated = key.mode === "test";
  try {
    await db.transaction(async (tx) => {
      if (!simulated) {
        await tx
          .insert(usageDays)
          .values({ day: utcDay(now), workspaceId: key.workspaceId })
          .onConflictDoNothing();
        await tx.execute(sql`select ${usageDays.id} from ${usageDays} where ${usageDays.workspaceId} = ${key.workspaceId} and ${usageDays.day} = ${utcDay(now)} for update`);
        const [usage] = await tx
          .select()
          .from(usageDays)
          .where(and(eq(usageDays.workspaceId, key.workspaceId), eq(usageDays.day, utcDay(now))))
          .limit(1);
        if (!usage || usage.acceptedEmails + usage.reservedEmails >= workspace.dailyLimit) {
          throw new Error("daily_limit_reached");
        }
        await tx
          .update(usageDays)
          .set({ reservedEmails: sql`${usageDays.reservedEmails} + 1`, updatedAt: now })
          .where(and(eq(usageDays.workspaceId, key.workspaceId), eq(usageDays.day, utcDay(now))));
      }
      await tx.insert(messages).values({
        id,
        workspaceId: key.workspaceId,
        domainId: domain.id,
        transactionalProfileId: profile.id,
        provider: domain.activeProvider,
        contentKind,
        stream: "transactional",
        source: "api",
        sendMode: key.mode,
        status: simulated ? "simulated" : "queued",
        fromEmail,
        fromName: parsed.data.from.name,
        toEmail,
        toName: parsed.data.to.name,
        replyTo,
        subject,
        html,
        plainText,
        tags: {
          ...(parsed.data.metadata.referenceId ? { referenceId: parsed.data.metadata.referenceId } : {}),
          ...(parsed.data.metadata.workspaceId ? { workspaceId: parsed.data.metadata.workspaceId } : {}),
        },
        idempotencyKey,
        requestHash,
        contentExpiresAt: new Date(now.getTime() + 30 * 864e5),
        sendDeadlineAt: new Date(now.getTime() + 24 * 3600e3),
      });
      const [queuedEvent] = await tx.insert(emailEvents).values({
        workspaceId: key.workspaceId,
        messageId: id,
        provider: domain.activeProvider,
        externalEventId: `yodev:queued:${id}`,
        type: "email.queued",
        occurredAt: now,
        payload: {},
      }).returning();
      for (const attachment of attachmentRows) {
        const updated = await tx
          .update(attachments)
          .set({ messageId: id, updatedAt: now })
          .where(and(eq(attachments.id, attachment.id), eq(attachments.workspaceId, key.workspaceId), isNull(attachments.messageId)))
          .returning({ id: attachments.id });
        if (!updated.length) throw new Error("attachment_not_ready");
      }
      if (!simulated) {
        await tx.insert(outboxJobs).values({ aggregateId: id, kind: "email", workspaceId: key.workspaceId });
        const endpoints = isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED")
          ? await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId, key.workspaceId), eq(webhookEndpoints.enabled, true)))
          : [];
        for (const endpoint of endpoints) {
          if (!endpoint.eventTypes.includes("email.queued")) continue;
          const [delivery] = await tx.insert(webhookDeliveries).values({ workspaceId: key.workspaceId, endpointId: endpoint.id, eventId: queuedEvent.id, nextAttemptAt: now }).onConflictDoNothing().returning();
          if (delivery) await tx.insert(outboxJobs).values({ workspaceId: key.workspaceId, aggregateId: delivery.id, kind: "webhook" });
        }
      }
      await tx.insert(idempotencyKeys).values({ workspaceId: key.workspaceId, key: idempotencyKey, requestHash, response: { ids: [id] } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "daily_limit_reached") {
      return NextResponse.json({ error: { code: "daily_limit_reached" } }, { status: 429 });
    }
    if (databaseErrorCode(error) === "23505") {
      const [winner] = await db.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.workspaceId, key.workspaceId),
        eq(idempotencyKeys.key, idempotencyKey),
      )).limit(1);
      if (winner?.requestHash === requestHash) {
        return NextResponse.json({ data: { id: winner.response.ids[0], status: simulated ? "simulated" : "queued" } }, { status: 202 });
      }
      if (winner) return NextResponse.json({ error: { code: "idempotency_conflict" } }, { status: 409 });
    }
    throw error;
  }
  return NextResponse.json({ data: { id, status: simulated ? "simulated" : "queued" } }, { status: 202 });
}
