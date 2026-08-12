# Transactional multi-provider architecture

## Acceptance path

1. Authenticate and scope the Yodev API key.
2. Atomically apply the workspace rate limit.
3. Validate the strict one-recipient body and mandatory idempotency key.
4. Resolve the verified domain, active provider binding and approved transactional profile.
5. Resolve an approved template, or require hybrid/raw authorization.
6. Confirm that every attachment is clean, unexpired and unused.
7. Reserve daily quota, create the message, claim attachments, create the queued event and outbox jobs in one database transaction.
8. The outbox worker enqueues only an opaque message ID.
9. The delivery worker claims the message and calls exactly one configured provider.
10. An explicit acceptance creates the usage ledger and `email.sent`; an ambiguous outcome becomes `unknown` without retry.

## Provider isolation

One provider account exists per workspace and provider. One binding exists per domain and provider, but only one binding can be active. The active provider is copied onto the message at acceptance and is never accepted from the client.

Postmark uses one Live Server per client workspace and a separate Server Token stored in SSM. SES uses one tenant, a Strict reputation policy, a transaction-only configuration set and tenant-level bounce/complaint suppressions.

Provider events are reduced to provider name, external event ID, provider message ID, opaque Yodev message/workspace IDs, normalized type, timestamp and reason code. The raw provider payload is neither queued nor persisted.

## Attachments

The API creates an opaque `pending/{uuid}` S3 key with SSE-KMS, checksum enforcement and a ten-minute presigned PUT. GuardDuty Malware Protection scans the object. The scan worker downloads only a clean result, verifies size, SHA-256 and magic/type consistency, and marks it `clean`. The delivery worker can read only clean database records; objects are deleted after terminal send and by a 24-hour lifecycle backstop.

## Failure semantics

- explicit pre-transmission or transient rejection: retry on the same provider;
- explicit permanent rejection: terminal `failed`;
- timeout or uncertain transmission: terminal `unknown`, operator alert, no automatic replay;
- no automatic failover between providers;
- only a still-queued message with no attempt may be reassigned manually.

## Expansion and contraction

Migrations `0003` through `0006` are the expansion phase. Historical marketing tables and columns remain only to permit a safe seven-day observation period. No active route, worker, page or queue uses them. A separate contraction migration must be generated and applied only after production counters prove those tables remain empty.
