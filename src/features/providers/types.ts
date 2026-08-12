export type EmailProviderName = "ses" | "postmark";

export type ProviderAttachment = {
  name: string;
  contentType: string;
  content: Uint8Array;
};

export type ProviderSendInput = {
  messageId: string;
  workspaceId: string;
  externalAccountId: string;
  credentialParameterName?: string | null;
  from: { email: string; name?: string | null };
  to: { email: string; name?: string | null };
  replyTo?: string | null;
  subject: string;
  html: string;
  text: string;
  attachments: ProviderAttachment[];
};

export type ProviderSendResult = {
  providerMessageId: string;
  acceptedAt: Date;
};

export type ProviderFailureKind = "definitive" | "transient" | "ambiguous";

export class ProviderSendError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderFailureKind,
    readonly code: string,
  ) {
    super(message);
    this.name = "ProviderSendError";
  }
}

export interface DeliveryProvider {
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}
