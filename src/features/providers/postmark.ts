import { getSecureParameter } from "@/workers/runtime-secrets";
import type { DeliveryProvider, ProviderSendInput } from "@/features/providers/types";
import { ProviderSendError } from "@/features/providers/types";

function mailbox(value: { email: string; name?: string | null }) {
  return value.name ? `${value.name.replace(/[<>]/g, "")} <${value.email}>` : value.email;
}

export class PostmarkDeliveryProvider implements DeliveryProvider {
  async send(input: ProviderSendInput) {
    if (process.env.POSTMARK_ENABLED !== "true") {
      throw new ProviderSendError("Postmark is not enabled for delivery.", "definitive", "postmark_disabled");
    }
    if (!input.credentialParameterName) {
      throw new ProviderSendError("Postmark credential is not configured.", "definitive", "provider_not_configured");
    }
    const token = await getSecureParameter(input.credentialParameterName);
    let response: Response;
    try {
      response = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": token,
        },
        body: JSON.stringify({
          From: mailbox(input.from),
          To: mailbox(input.to),
          ReplyTo: input.replyTo ?? undefined,
          Subject: input.subject,
          HtmlBody: input.html,
          TextBody: input.text,
          MessageStream: "outbound",
          TrackOpens: false,
          TrackLinks: "None",
          Metadata: {
            ym_message_id: input.messageId,
            ym_workspace_id: input.workspaceId,
          },
          Attachments: input.attachments.map((attachment) => ({
            Name: attachment.name,
            ContentType: attachment.contentType,
            Content: Buffer.from(attachment.content).toString("base64"),
          })),
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ProviderSendError(
        "Postmark request outcome is unknown.",
        "ambiguous",
        "provider_outcome_unknown",
      );
    }
    const body: unknown = await response.json().catch(() => null);
    const payload = body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown> : null;
    const errorCode = typeof payload?.ErrorCode === "number" && Number.isSafeInteger(payload.ErrorCode) && payload.ErrorCode >= 0
      ? payload.ErrorCode : null;
    if (!response.ok) {
      // A server failure does not prove that the email was not accepted. Never
      // replay it automatically. Only a rate-limit rejection is safely retryable.
      const kind = response.status >= 500 ? "ambiguous" : response.status === 429 ? "transient" : "definitive";
      throw new ProviderSendError(
        kind === "ambiguous" ? "Postmark request outcome is unknown." : `Postmark rejected the request (${response.status}).`,
        kind,
        kind === "ambiguous" ? "provider_outcome_unknown" : `postmark_${errorCode ?? response.status}`,
      );
    }
    if (!payload || errorCode === null) {
      throw new ProviderSendError("Postmark response did not prove acceptance.", "ambiguous", "provider_outcome_unknown");
    }
    if (errorCode !== 0) {
      throw new ProviderSendError("Postmark rejected the request.", "definitive", `postmark_${errorCode}`);
    }
    const acceptedAt = payload.SubmittedAt === undefined ? new Date()
      : typeof payload.SubmittedAt === "string" ? new Date(payload.SubmittedAt) : new Date(NaN);
    if (typeof payload.MessageID !== "string" || !/^[a-zA-Z0-9-]{1,180}$/.test(payload.MessageID) || !Number.isFinite(acceptedAt.getTime())) {
      throw new ProviderSendError("Postmark response did not prove acceptance.", "ambiguous", "provider_outcome_unknown");
    }
    return {
      providerMessageId: payload.MessageID,
      acceptedAt,
    };
  }
}
