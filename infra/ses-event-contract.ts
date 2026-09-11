import { EventField, RuleTargetInput, type EventPattern } from "aws-cdk-lib/aws-events";

export function sesEventPattern(account: string, region: string, environment: "dev" | "prod"): EventPattern {
  return {
    source: ["aws.ses"], account: [account], region: [region],
    detail: {
      eventType: ["Delivery", "Bounce", "Complaint", "Reject", "DeliveryDelay"],
      mail: { tags: { ym_workspace_id: [{ exists: true }], ym_message_id: [{ exists: true }], ym_environment: [environment] } },
    },
  };
}

// Shared with the dedicated test-account probe. Never forward the raw SES event.
export function sanitizedSesEventInput() {
  return RuleTargetInput.fromObject({
    eventId: EventField.eventId,
    eventType: EventField.fromPath("$.detail.eventType"),
    providerMessageId: EventField.fromPath("$.detail.mail.messageId"),
    messageId: EventField.fromPath("$.detail.mail.tags.ym_message_id[0]"),
    workspaceId: EventField.fromPath("$.detail.mail.tags.ym_workspace_id[0]"),
    environment: EventField.fromPath("$.detail.mail.tags.ym_environment[0]"),
    // mail.timestamp is the original send time, not the lifecycle event time.
    occurredAt: EventField.time,
    bounceType: EventField.fromPath("$.detail.bounce.bounceType"),
  });
}
