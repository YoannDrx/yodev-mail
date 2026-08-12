# Mail by Yodev

Mail by Yodev is a private, API-only gateway for transactional email. Yodev owns and operates the provider accounts; clients use only `ym_test_*` and `ym_live_*` keys, verified domains, approved transactional profiles and approved templates.

The public contract never accepts a provider, `cc`, `bcc`, tracking option, campaign, audience or contact import. Postmark is the initial production route. Amazon SES is implemented for sandbox tests and remains disabled in production until AWS explicitly grants production access.

## Stack

- Next.js 16, React 19 and TypeScript
- Clerk Organizations
- Neon Postgres and Drizzle migrations
- Postmark Platform and Amazon SES v2 behind a provider-neutral delivery interface
- SQS, Lambda, EventBridge, S3, KMS, GuardDuty Malware Protection and SSM SecureString
- Stripe Billing
- Vitest, Playwright and AWS CDK

## Commands

```bash
npm run dev
npm run check
npm run test:e2e
npm run db:generate
npm run db:migrate
npm run infra:synth
npm run stripe:sync
npm run stripe:verify
```

Copy `.env.example` to `.env.local` for local development. Never use `drizzle-kit push` against production. Create and verify a Neon restore branch before every production migration.

## Delivery contract

- `POST /v1/emails` requires `Idempotency-Key`, one sender, one recipient and an approved category.
- Test keys perform full validation and return `simulated` without delivery or billing.
- Live messages resolve their provider from the active domain binding; the client cannot choose it.
- Templates are the default. Raw HTML requires both a hybrid workspace policy and `emails:send:raw`.
- Attachments use presigned uploads, SHA-256 verification, MIME checks, GuardDuty scanning and a 24-hour maximum lifetime.
- A timeout after possible provider transmission becomes `unknown` and is never retried automatically.
- Customer webhooks expose only Yodev event names and are signed with `x-yodev-mail-signature` and `x-yodev-mail-timestamp`.

## Privacy and reputation contract

- Queue bodies, object keys, SES tags and operational logs contain opaque identifiers only.
- Message bodies expire after 30 days; attachments after 24 hours; normalized technical events after 90 days.
- No open pixel or link rewriting is enabled.
- A first complaint, three hard bounces, or a hard-bounce rate of at least 2% after 50 accepted messages pauses the workspace.
- Initial quotas are 50/day, 200/day after three clean days and 500/day after seven clean days.

## AWS activation

Workload stacks are passive unless explicitly activated:

```bash
YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN=arn:aws:iam::274319534967:oidc-provider/oidc.vercel.com/yoanndrxs-projects \
  YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS=dev npm run infra:deploy:dev
YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN=arn:aws:iam::274319534967:oidc-provider/oidc.vercel.com/yoanndrxs-projects \
  YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS=prod npm run infra:deploy:prod
```

Always pass the existing OIDC provider ARN when diffing or deploying. Omitting `YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS` intentionally synthesizes passive workers and schedules; it must never be used for an active production deployment.

`YODEV_MAIL_GUARDDUTY_ENABLED` remains `false` until the account has completed the one-time “GuardDuty Malware Protection for S3 only” enrollment. The attachment API stays disabled in Vercel until a subsequent deployment with this flag set to `true` succeeds.

Production CDK sets `SES_ENABLED=false`. Postmark credentials are stored under:

```text
/yodev-mail-prod/providers/postmark/account-token
/yodev-mail-prod/providers/postmark/workspaces/{workspaceId}/server-token
/yodev-mail-prod/providers/postmark/workspaces/{workspaceId}/webhook-password
```

Runtime database, webhook and Stripe secrets are stored under `/yodev-mail-{environment}/runtime/`. Vercel accesses AWS through its project-scoped OIDC role, never a static AWS access key.

See [architecture](docs/architecture.md) and the [production runbook](docs/production-runbook.md).
