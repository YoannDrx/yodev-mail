import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import { awsClients } from "@/lib/aws";
import type { DeliveryProvider, ProviderSendInput } from "@/features/providers/types";
import { ProviderSendError } from "@/features/providers/types";

function mailbox(value: { email: string; name?: string | null }) {
  return value.name ? `${value.name.replace(/[<>]/g, "")} <${value.email}>` : value.email;
}

export class SesDeliveryProvider implements DeliveryProvider {
  async send(input: ProviderSendInput) {
    if (process.env.SES_ENABLED !== "true") {
      throw new ProviderSendError("Amazon SES is not enabled for production delivery.", "definitive", "ses_disabled");
    }
    const { ses } = await awsClients();
    try {
      const response = await ses.send(
        new SendEmailCommand({
          TenantName: input.externalAccountId,
          ConfigurationSetName: `${input.externalAccountId}-txn`,
          FromEmailAddress: mailbox(input.from),
          Destination: { ToAddresses: [mailbox(input.to)] },
          ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
          Content: {
            Simple: {
              Subject: { Data: input.subject, Charset: "UTF-8" },
              Body: {
                Html: { Data: input.html, Charset: "UTF-8" },
                Text: { Data: input.text, Charset: "UTF-8" },
              },
              Attachments: input.attachments.map((attachment) => ({
                RawContent: attachment.content,
                FileName: attachment.name,
                ContentType: attachment.contentType,
                ContentDisposition: "ATTACHMENT",
              })),
            },
          },
          EmailTags: [
            { Name: "ym_message_id", Value: input.messageId },
            { Name: "ym_workspace_id", Value: input.workspaceId },
          ],
        }),
      );
      if (!response.MessageId) {
        throw new ProviderSendError("SES did not return a message identifier.", "ambiguous", "provider_outcome_unknown");
      }
      return { providerMessageId: response.MessageId, acceptedAt: new Date() };
    } catch (error) {
      if (error instanceof ProviderSendError) throw error;
      const name = (error as { name?: string }).name ?? "unknown";
      const transient = [
        "AccountSuspendedException",
        "InternalServiceErrorException",
        "ServiceUnavailableException",
        "ThrottlingException",
        "TooManyRequestsException",
      ].includes(name);
      const definitive = ["BadRequestException", "MessageRejected", "MailFromDomainNotVerifiedException"].includes(name);
      throw new ProviderSendError(
        error instanceof Error ? error.message : "SES delivery failed.",
        definitive ? "definitive" : transient ? "transient" : "ambiguous",
        `ses_${name}`,
      );
    }
  }
}
