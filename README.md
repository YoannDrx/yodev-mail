# Mail by Yodev

Mail by Yodev is a private, API-only gateway for transactional email. Yodev owns and operates the provider accounts; clients use only `ym_test_*` and `ym_live_*` keys, verified domains, approved transactional profiles and approved templates.

The public contract never accepts a provider, `cc`, `bcc`, tracking option, campaign, audience or contact import. Postmark is the initial production route. Amazon SES is implemented for sandbox tests and remains disabled in production until AWS explicitly grants production access.

## Stack

- Next.js 16, React 19 and TypeScript
- Better Auth avec Google OAuth, organisations, passkeys et authentification email optionnelle
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

Run `npm run env:normalize` to create or reorganize the single local runtime
file, `.env.local`, from the documented `.env.example` template. The command
preserves existing values for supported keys, removes obsolete keys and never
prints secrets. Keep `.env.local` ignored by Git; do not create a competing
`.env`, `.env.development` or `.env.production` file. After pulling Development
variables from Vercel, run the normalizer again:

```bash
npx vercel env pull .env.local --environment=development --yes
npm run env:normalize
```

Never use `drizzle-kit push` against production. Create and verify a Neon
restore branch before every production migration.

## Delivery contract

- `POST /v1/emails` requires `Idempotency-Key`, one sender, one recipient and an approved category.
- Test keys perform full validation and return `simulated` without delivery or billing.
- Live messages resolve their provider from the active domain binding; the client cannot choose it.
- Templates are the default. Raw HTML requires both a hybrid workspace policy and `emails:send:raw`.
- Attachments use presigned uploads, SHA-256 verification, MIME checks, GuardDuty scanning and a 24-hour maximum lifetime.
- A timeout after possible provider transmission becomes `unknown` and is never retried automatically.
- Customer webhooks expose only Yodev event names and are signed with `x-yodev-mail-signature` and `x-yodev-mail-timestamp`.

All externally consequential capabilities are fail-closed. New environments start with commercial onboarding, live checkout, Stripe usage reporting, customer webhooks, attachments, raw email and live acceptance disabled. Open one gate at a time only after the matching migration, isolated test and production certification in the runbook.

## Privacy and reputation contract

- Queue bodies, object keys, SES tags and operational logs contain opaque identifiers only.
- Message bodies expire after 30 days; attachments after 24 hours. Recipient/sender fields and suppression addresses are redacted after 90 days, and normalized technical events are deleted after 90 days.
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

`YODEV_MAIL_GUARDDUTY_ENABLED` must match the deployed account state when diffing. Malware Protection is currently active for the `pending/` prefix in production, but the attachment API remains closed until the application path has passed its isolated checksum/MIME/scan/expiry tests.

`YODEV_MAIL_POSTMARK_ENABLED` must likewise match the deployed account state. Postmark is currently enabled in the production workload; a new environment must keep it disabled until the account, Platform, retention, system domain and content-free webhooks are verified.

`YODEV_MAIL_STRIPE_USAGE_REPORTING_ENABLED` is the CDK synthesis input for the scheduled AWS usage worker. It sets the Lambda runtime gate `STRIPE_USAGE_REPORTING_ENABLED` and defaults to `false`; enable it only for an active workload after the Stripe meter and reconciliation path are certified.

Production CDK sets `SES_ENABLED=false`. Postmark credentials are stored under:

```text
/yodev-mail-prod/providers/postmark/account-token
/yodev-mail-prod/providers/postmark/system/server-token
/yodev-mail-prod/providers/postmark/system/webhook-password
/yodev-mail-prod/providers/postmark/workspaces/{workspaceId}/server-token
/yodev-mail-prod/providers/postmark/workspaces/{workspaceId}/webhook-password
```

Runtime database, webhook and Stripe secrets are stored under `/yodev-mail-{environment}/runtime/`. Vercel accesses AWS through its project-scoped OIDC role, never a static AWS access key.

The foundation stack creates an encrypted multi-region management CloudTrail, one-year CloudWatch/S3 retention, an immediate root-account alarm and staged account cost alerts. It does not record email data events.

Better Auth uses a distinct `BETTER_AUTH_SECRET` and Google OAuth client in every environment. Public organization creation is disabled; the first organization is rebound to the existing workspace only for `AUTH_BOOTSTRAP_EMAIL`. Email/password stays disabled until the Postmark system Server is approved and configured.

See [architecture](docs/architecture.md) and the [production runbook](docs/production-runbook.md).
