# Runbook: dead-letter queue inspection and redrive

Scope: the four SQS work queues of a workload stack (`yodev-mail-{env}-…`) in
`eu-west-3`. Each main queue moves a message to its DLQ after five failed
receives; DLQs keep messages for 14 days, main queues for 4 days. In
production (`live`/`certification`), the `…DlqMessagesAlarm` alarm fires on the
first message in any DLQ and notifies the operations SNS topic.

| Queue | DLQ | Consumer | Replay safety |
|---|---|---|---|
| `email-send` | `email-send-dlq` | `send-email` | The worker only claims a message in `queued`. Anything already `sent`, `failed`, `unknown` or past its send deadline is skipped. |
| `provider-events` | `provider-events-dlq` | `provider-events` (`ses-events.ts`) | Events are deduplicated by `(provider, external_event_id)`; billing confirmations are guarded by the usage ledger. |
| `provider-provisioning` | `provider-provisioning-dlq` | `provider-provisioning` | Reconciliation is idempotent and never replaces an existing provider account. |
| `customer-webhooks` | `customer-webhooks-dlq` | `customer-webhooks` | Deliveries with `delivered_at` or `terminal_at` are skipped; a claim is conditional. |

Queue bodies contain only opaque UUIDs (`workspaceId`, `messageId`,
`bindingId`, `deliveryId`) or a sanitized provider event. Never paste a body
next to an email address or message content in a ticket or chat.

## What happens to a stranded email automatically

A job that reaches `email-send-dlq` leaves its message `queued`. The
`RecoverStaleSending` schedule (every 5 minutes) now also runs
`expireQueuedPastDeadline`: once `send_deadline_at` (24 hours after
acceptance; `queued_at + 24 h` for older rows) has passed, the message becomes
`failed` with `last_error = 'send_deadline_exceeded'`, its daily quota
reservation is released, a `failed` attempt is recorded and the customer
receives `email.failed` exactly as when the send worker itself sees an expired
deadline. Such a message is never sent later, even if its DLQ job is redriven.

Messages still before their deadline can be redriven and will be sent.

## Procedure

1. **Acknowledge** the alarm and record operator, time, environment and queue.
2. **Stop the cause first.** Read the consumer's log group
   (`/aws/lambda/yodev-mail-{env}-{worker}`) around the alarm time. Logs carry
   the SQS `correlationId` and an error code, never addresses. Typical causes:
   database unavailable, provider outage, a deployment error. Do not redrive
   while the cause is still present: messages would return to the DLQ.
3. **Count without consuming:**
   ```bash
   aws sqs get-queue-attributes --region eu-west-3 \
     --queue-url "$DLQ_URL" --attribute-names ApproximateNumberOfMessages
   ```
   To inspect, receive with a short visibility timeout and **do not delete**:
   ```bash
   aws sqs receive-message --region eu-west-3 --queue-url "$DLQ_URL" \
     --max-number-of-messages 10 --visibility-timeout 30
   ```
4. **Check the state in the database** for each `email-send` job before
   redriving (read-only, scoped by workspace):
   ```sql
   select id, status, send_deadline_at, last_error
   from messages where workspace_id = $1 and id = $2;
   ```
   - `queued` and before `send_deadline_at`: redrive.
   - `failed` with `send_deadline_exceeded`: nothing to do; the redrive is a
     no-op. Tell the customer only if they ask: they already received
     `email.failed`.
   - `unknown`: **never replay.** Reconcile with the provider (message stream
     activity in Postmark) first, as the production runbook requires.
5. **Redrive** with SQS's native move task, back to the source queue:
   ```bash
   aws sqs start-message-move-task --region eu-west-3 \
     --source-arn "$DLQ_ARN" --destination-arn "$MAIN_QUEUE_ARN" \
     --max-number-of-messages-per-second 5
   aws sqs list-message-move-tasks --region eu-west-3 --source-arn "$DLQ_ARN"
   ```
   Keep the rate low: the send worker runs with a maximum concurrency of 2.
6. **Verify:** the DLQ is empty, the main queue age alarm is `OK`, and
   ```sql
   select status, count(*) from messages
   where workspace_id = $1 and id = any($2) group by status;
   ```
   shows no message left in `queued` past its deadline.
7. **Close** the incident with the counts (moved, sent, already failed) and the
   cause. A message that returns to the DLQ after a redrive is a defect: do not
   redrive it a second time without a fix.

In `standby` there is no event-source mapping: messages stay in the main queue
and nothing reaches a DLQ. Do not redrive into a standby stack.
