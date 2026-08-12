export type NormalizedProviderEvent = {
  provider: "ses" | "postmark";
  externalEventId: string;
  providerMessageId: string;
  messageId?: string;
  workspaceId?: string;
  type: "sent" | "delivered" | "soft_bounced" | "hard_bounced" | "complained" | "failed";
  occurredAt: Date;
  reasonCode?: string;
};
