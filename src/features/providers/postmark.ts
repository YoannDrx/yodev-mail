import { getSecureParameter } from "@/workers/runtime-secrets";
import type { DeliveryProvider, ProviderSendInput } from "@/features/providers/types";
import { ProviderSendError } from "@/features/providers/types";

type PostmarkResponse = {
  ErrorCode?: number;
  Message?: string;
  MessageID?: string;
  SubmittedAt?: string;
};

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
    } catch (error) {
      throw new ProviderSendError(
        error instanceof Error ? error.message : "Postmark request outcome is unknown.",
        "ambiguous",
        "provider_outcome_unknown",
      );
    }
    const payload = (await response.json().catch(() => ({}))) as PostmarkResponse;
    if (!response.ok || payload.ErrorCode !== 0 || !payload.MessageID) {
      const kind = response.status >= 500 || response.status === 429 ? "transient" : "definitive";
      throw new ProviderSendError(
        payload.Message ?? `Postmark rejected the request (${response.status}).`,
        kind,
        `postmark_${payload.ErrorCode ?? response.status}`,
      );
    }
    return {
      providerMessageId: payload.MessageID,
      acceptedAt: payload.SubmittedAt ? new Date(payload.SubmittedAt) : new Date(),
    };
  }
}
