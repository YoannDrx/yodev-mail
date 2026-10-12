import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
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
import { causalErrorCode } from "@/features/api/safe-route";
import { normalizeEmail } from "@/features/email-address/normalization";
import { combinedContentSize, estimatedMimeSize, isRawContent, sendEmailSchema } from "@/features/emails/schema";
import { evaluateStoredMessage, utcDay } from "@/features/sending/eligibility";
import {
  renderApprovedTemplate,
  TemplateVariablesMissingError,
  TemplateVariablesTooLongError,
} from "@/features/templates/render";
import { canonicalJson, sha256 } from "@/lib/crypto";
import { isFeatureEnabled } from "@/lib/env";

export type EmailAcceptanceInput = {
  workspaceId: string;
  mode: "test" | "live";
  scopes: string[];
  idempotencyKey: string;
  // Looked up by the caller before rate limiting, so a retry replays for free.
  existing: typeof idempotencyKeys.$inferSelect | undefined;
  raw: unknown;
  source?: "api" | "console";
};

export type EmailAcceptanceResult = { status: number; body: Record<string, unknown> };

function respond(status: number, body: Record<string, unknown>): EmailAcceptanceResult {
  return { status, body };
}

// The acceptance contract shared by POST /v1/emails and the console test send.
// Callers own authentication, the live gate, rate limiting and HTTP framing;
// everything that decides whether a message exists is here, once.
export async function acceptEmail(input: EmailAcceptanceInput): Promise<EmailAcceptanceResult> {
  const db = requireDb();
  const { existing, idempotencyKey, raw } = input;
  const parsed = sendEmailSchema.safeParse(raw);
  if (!parsed.success) {
    return respond(422, { error: { code: "invalid_request", details: parsed.error.flatten() } });
  }
  if (parsed.data.attachments.length && !isFeatureEnabled("ATTACHMENTS_ENABLED")) {
    return respond(503, { error: { code: "attachments_unavailable", message: "Les pièces jointes sont temporairement désactivées." } });
  }

  const requestHash = sha256(canonicalJson(parsed.data));
  const fromEmail = normalizeEmail(parsed.data.from.email);
  const toEmail = normalizeEmail(parsed.data.to.email);
  const replyTo = parsed.data.replyTo
    ? normalizeEmail(parsed.data.replyTo)
    : undefined;
  if (existing) {
    if (existing.requestHash !== requestHash) {
      return respond(409, { error: { code: "idempotency_conflict", message: "Cette clé a déjà été utilisée avec un corps différent." } });
    }
    const [message] = await db
      .select({ id: messages.id, status: messages.status })
      .from(messages)
      .where(and(eq(messages.id, existing.response.ids[0]), eq(messages.workspaceId, input.workspaceId)))
      .limit(1);
    return respond(202, { data: message ?? { id: existing.response.ids[0], status: "queued" } });
  }

  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
  if (!workspace) return respond(404, { error: { code: "workspace_not_found" } });

  const domainName = fromEmail.split("@").at(-1)!;
  const availableDomains = await db
    .select()
    .from(domains)
    .where(and(eq(domains.workspaceId, input.workspaceId), eq(domains.status, "verified")));
  const domain = availableDomains
    .filter((candidate) => domainName === candidate.name || domainName.endsWith(`.${candidate.name}`))
    .sort((left, right) => right.name.length - left.name.length)[0];
  if (!domain?.activeProvider) {
    return respond(403, { error: { code: "domain_not_ready", message: "Le domaine expéditeur n’a aucun service de livraison actif." } });
  }

  const [profile] = await db
    .select()
    .from(transactionalProfiles)
    .where(and(
      eq(transactionalProfiles.workspaceId, input.workspaceId),
      eq(transactionalProfiles.key, parsed.data.category),
      eq(transactionalProfiles.status, "approved"),
    ))
    .limit(1);
  if (!profile) {
    return respond(403, { error: { code: "transactional_profile_not_approved", message: "Le cas d’usage transactionnel n’est pas approuvé." } });
  }

  let subject: string;
  let html: string;
  let plainText: string;
  let contentKind: "template" | "raw";
  if (isRawContent(parsed.data.content)) {
    if (!isFeatureEnabled("RAW_EMAIL_ENABLED") || workspace.contentPolicy !== "hybrid" || !input.scopes.includes("emails:send:raw")) {
      return respond(403, { error: { code: "raw_content_forbidden", message: "Cette clé ne peut envoyer que des templates approuvés." } });
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
        eq(templates.workspaceId, input.workspaceId),
        eq(templates.transactionalProfileId, profile.id),
        eq(templates.reviewStatus, "approved"),
        eq(templateVersions.workspaceId, input.workspaceId),
      ))
      .orderBy(desc(templateVersions.version))
      .limit(1);
    if (!version) return respond(404, { error: { code: "template_not_approved" } });
    try {
      ({ subject, html, plainText } = renderApprovedTemplate({
        subject: version.subject,
        html: version.html,
        plainText: version.plainText,
        variables: parsed.data.content.variables,
      }));
    } catch (error) {
      if (error instanceof TemplateVariablesMissingError) {
        return respond(422, { error: { code: "template_variables_missing", details: { missing: error.missingVariables } } });
      }
      if (error instanceof TemplateVariablesTooLongError) {
        return respond(422, { error: { code: "template_variables_too_long", details: { variables: error.variables } } });
      }
      throw error;
    }
    contentKind = "template";
  }

  subject = subject.replace(/[\r\n]+/g, " ").trim();

  const attachmentIds = parsed.data.attachments.map((attachment) => attachment.id);
  const contentBytes = combinedContentSize(html, plainText);
  if (contentBytes > 512_000) {
    return respond(422, { error: { code: "content_too_large" } });
  }
  const attachmentRows = attachmentIds.length
    ? await db.select().from(attachments).where(and(
        eq(attachments.workspaceId, input.workspaceId),
        inArray(attachments.id, attachmentIds),
        eq(attachments.status, "clean"),
        gt(attachments.expiresAt, new Date()),
        isNull(attachments.messageId),
      ))
    : [];
  if (attachmentRows.length !== attachmentIds.length || new Set(attachmentRows.map((row) => row.id)).size !== attachmentIds.length) {
    return respond(409, { error: { code: "attachment_not_ready", message: "Une pièce jointe est absente, expirée, déjà utilisée ou non validée." } });
  }
  const attachmentBytes = attachmentRows.reduce((total, attachment) => total + attachment.sizeBytes, 0);
  if (attachmentBytes > 6 * 1024 * 1024) {
    return respond(422, { error: { code: "attachments_too_large" } });
  }
  if (estimatedMimeSize(contentBytes, attachmentBytes, attachmentRows.length) >= 9 * 1024 * 1024) {
    return respond(422, { error: { code: "message_too_large" } });
  }

  const eligibility = await evaluateStoredMessage(db, {
    domainId: domain.id,
    mode: input.mode,
    profileId: profile.id,
    provider: domain.activeProvider,
    toEmail,
    workspaceId: input.workspaceId,
  });
  if (!eligibility.allowed) {
    return respond(403, { error: { code: eligibility.code, message: eligibility.reason } });
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const simulated = input.mode === "test";
  try {
    await db.transaction(async (tx) => {
      if (!simulated) {
        await tx
          .insert(usageDays)
          .values({ day: utcDay(now), workspaceId: input.workspaceId })
          .onConflictDoNothing();
        await tx.execute(sql`select ${usageDays.id} from ${usageDays} where ${usageDays.workspaceId} = ${input.workspaceId} and ${usageDays.day} = ${utcDay(now)} for update`);
        const [usage] = await tx
          .select()
          .from(usageDays)
          .where(and(eq(usageDays.workspaceId, input.workspaceId), eq(usageDays.day, utcDay(now))))
          .limit(1);
        if (!usage || usage.acceptedEmails + usage.reservedEmails >= workspace.dailyLimit) {
          throw new Error("daily_limit_reached");
        }
        await tx
          .update(usageDays)
          .set({ reservedEmails: sql`${usageDays.reservedEmails} + 1`, updatedAt: now })
          .where(and(eq(usageDays.workspaceId, input.workspaceId), eq(usageDays.day, utcDay(now))));
      }
      await tx.insert(messages).values({
        id,
        workspaceId: input.workspaceId,
        domainId: domain.id,
        transactionalProfileId: profile.id,
        provider: domain.activeProvider,
        contentKind,
        stream: "transactional",
        source: input.source ?? "api",
        sendMode: input.mode,
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
        // Leave two hours for scheduled maintenance before the public 30-day cap.
        contentExpiresAt: new Date(now.getTime() + 30 * 864e5 - 2 * 3600e3),
        sendDeadlineAt: new Date(now.getTime() + 24 * 3600e3),
      });
      const [queuedEvent] = await tx.insert(emailEvents).values({
        workspaceId: input.workspaceId,
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
          .where(and(eq(attachments.id, attachment.id), eq(attachments.workspaceId, input.workspaceId), isNull(attachments.messageId)))
          .returning({ id: attachments.id });
        if (!updated.length) throw new Error("attachment_not_ready");
      }
      if (!simulated) {
        await tx.insert(outboxJobs).values({ aggregateId: id, kind: "email", workspaceId: input.workspaceId });
        const endpoints = isFeatureEnabled("CUSTOMER_WEBHOOKS_ENABLED")
          ? await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.workspaceId, input.workspaceId), eq(webhookEndpoints.enabled, true)))
          : [];
        for (const endpoint of endpoints) {
          if (!endpoint.eventTypes.includes("email.queued")) continue;
          const [delivery] = await tx.insert(webhookDeliveries).values({ workspaceId: input.workspaceId, endpointId: endpoint.id, eventId: queuedEvent.id, nextAttemptAt: now }).onConflictDoNothing().returning();
          if (delivery) await tx.insert(outboxJobs).values({ workspaceId: input.workspaceId, aggregateId: delivery.id, kind: "webhook" });
        }
      }
      await tx.insert(idempotencyKeys).values({ workspaceId: input.workspaceId, key: idempotencyKey, requestHash, response: { ids: [id] } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "daily_limit_reached") {
      return respond(429, { error: { code: "daily_limit_reached" } });
    }
    if (causalErrorCode(error) === "23505") {
      const [winner] = await db.select().from(idempotencyKeys).where(and(
        eq(idempotencyKeys.workspaceId, input.workspaceId),
        eq(idempotencyKeys.key, idempotencyKey),
      )).limit(1);
      if (winner?.requestHash === requestHash) {
        return respond(202, { data: { id: winner.response.ids[0], status: simulated ? "simulated" : "queued" } });
      }
      if (winner) return respond(409, { error: { code: "idempotency_conflict" } });
    }
    throw error;
  }
  return respond(202, { data: { id, status: simulated ? "simulated" : "queued" } });
}

