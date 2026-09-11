# Mail by Yodev

Mail by Yodev is a private, API-only gateway for transactional email. Yodev owns and operates the provider accounts; clients use only `ym_test_*` and `ym_live_*` keys, verified domains, approved transactional profiles and approved templates.

The source code is licensed under the GNU Affero General Public License v3.0
(`AGPL-3.0-only`). Security issues must be reported privately according to
[`SECURITY.md`](SECURITY.md).

The public contract never accepts a provider, `cc`, `bcc`, tracking option, campaign, audience or contact import. Postmark is the initial production route. Amazon SES is implemented for sandbox tests and remains disabled in production until AWS explicitly grants production access.

## Stack

- Next.js 16, React 19 and TypeScript
- Better Auth avec Google OAuth, organisations, passkeys et authentification email optionnelle
- Neon Postgres and Drizzle migrations
- Postmark Platform and Amazon SES v2 behind a provider-neutral delivery interface
- SQS, Lambda, EventBridge, S3, KMS, GuardDuty Malware Protection and SSM SecureString
- Stripe Billing
- Vitest, Playwright and AWS CDK

## Languages and routing

The human interface is available in French and English under explicit `/fr`
and `/en` prefixes. Requests without a prefix are redirected according to the
`yodev_mail_locale` cookie, then the browser `Accept-Language` header, with
French as the fallback. The language selector preserves the current route and
query parameters, including invitation and password-reset tokens.

Machine contracts are intentionally never localized: `/api`, `/v1`, `/health`
and `/openapi.json` keep stable URLs and payloads. Public pages publish
canonical and `hreflang` alternates, and the sitemap contains both locales.
Authentication system emails include French and English because a recipient's
language is not persisted before they accept an invitation.

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
`.env`, `.env.development` or `.env.production` file. Vercel Development is
intentionally empty; local commands never pull remote secrets into another
file. Re-run the normalizer after editing `.env.local`:

```bash
npm run env:normalize
```

The local AWS account directory uses `YODEV_MAIL_AWS_MANAGEMENT_*` and
`YODEV_MAIL_AWS_TEST_*` for account names, IDs, administrative emails, profiles
and regions; `YODEV_MAIL_AWS_SSO_*` documents the existing SSO login. Explicit
`YODEV_MAIL_AWS_DEV_ACCOUNT_ID` and `YODEV_MAIL_AWS_PROD_ACCOUNT_ID` record that
both current workloads still share the management account. These are operator
reference values, not an automatic account switch. Preserve `AWS_PROFILE`,
`AWS_ACCOUNT_ID`, runtime resource ARNs and operating modes when adding account
metadata. Keep SSO credentials in the AWS CLI credential store, never in `.env`
files, and do not upload this directory to Vercel. See the
[test-account setup report](docs/aws-test-account-2026-09-10.md).

Never use `drizzle-kit push` against production. Create and verify a Neon
restore branch before every production migration.

### Authenticated browser certification

`npm run test:e2e:auth` exercises real Better Auth sessions, tenant isolation,
workspace switching, invitation acceptance, API-key authorization/revocation and
WebAuthn with Chromium's virtual authenticator. It does not mock authentication.
Create a **disposable local PostgreSQL database named `yodev_mail_auth_e2e`**,
apply the committed migrations, then run:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55441/yodev_mail_auth_e2e npm run test:e2e:auth
```

Use the actual local port and credentials for your disposable database. The
runner rejects remote hosts, other database names and connection query options.
It never falls back to `.env.local` for its database. The dedicated CI job
provisions PostgreSQL and applies migrations automatically.

The suite runs serially on `http://localhost:3918`, creates synthetic verified
accounts and resets only its local authentication rate-limit table between cases.
It generates ephemeral authentication secrets, disables providers, payments and
live sending, and blocks browser requests to other origins. It never sends an
invitation email: the pending invitation is seeded before exercising acceptance.
These tests do not certify real Google OAuth, email delivery, physical passkey
devices or production billing. Traces contain synthetic accounts only.

Run the expurgated production baseline without displaying addresses, content or
secrets:

```bash
npm run internal-go:audit -- --baseline --workspace-id=<workspace-uuid> --expected-version=abc1234
```

After the controlled Gmail, Microsoft and Apple canaries, start the final
72-hour verification from their ISO-8601 start timestamp:

```bash
npm run internal-go:audit -- --workspace-id=<workspace-uuid> --canary-since=2026-08-18T18:00:00+02:00 --expected-version=abc1234
```

Replace `<workspace-uuid>` with the explicitly approved workspace ID (without angle brackets).
Replace the example timestamp and short SHA with the controlled canary start and
the version returned by both production health endpoints.

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
npm run infra:deploy:dev
npm run infra:deploy:prod
```

The infrastructure scripts load the same ignored `.env.local` as the application and database scripts. Before every diff or deployment, keep `YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN` set to the existing provider and set `YODEV_MAIL_AWS_OPERATING_MODE_DEV` and `YODEV_MAIL_AWS_OPERATING_MODE_PROD` explicitly to `standby`, `certification` or `live`. Both environments are currently in `standby`; this is the safe default while no real client is active. `YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS` remains only as a backwards-compatible fallback when no explicit mode is set.

`standby` removes SQS event-source mappings, disables every workload EventBridge rule, closes provider and billing runtime gates, and suppresses workload alarms. `certification` and `live` activate the transport; the independent product gates still determine which synthetic or commercial traffic may enter the system. Scheduled invocations are not retried by EventBridge because the next scheduled run is the bounded recovery attempt.

Set `YODEV_MAIL_BUDGET_ALERT_EMAILS` to the comma-separated operational
recipients that must receive account budget alerts. This is distinct from
`YODEV_MAIL_ALERT_EMAIL`, which controls the encrypted SNS operations topic.

`YODEV_MAIL_GUARDDUTY_ENABLED` must match the deployed account state when diffing. Malware Protection is currently active for the `pending/` prefix in production, but the attachment API remains closed until the application path has passed its isolated checksum/MIME/scan/expiry tests.

`YODEV_MAIL_POSTMARK_ENABLED` must likewise match the intended account state. Postmark credentials are configured for production, but every worker receives `POSTMARK_ENABLED=false` while the workload is in standby. A new environment must keep it disabled until the account, Platform, retention, system domain and content-free webhooks are verified.

`YODEV_MAIL_STRIPE_USAGE_REPORTING_ENABLED` is the CDK synthesis input for the scheduled AWS usage worker. It sets the Lambda runtime gate `STRIPE_USAGE_REPORTING_ENABLED` and defaults to `false`; enable it only for an active workload after the Stripe meter and reconciliation path are certified.

`YODEV_MAIL_SES_ENABLED` is the only CDK synthesis input that can set the
Lambda runtime `SES_ENABLED=true`. It defaults to `false`, and a standby stack
stays closed even when the input is accidentally enabled. Keep it false outside
an explicitly approved SES certification window.

SES workers also require `DEPLOYMENT_ENVIRONMENT=dev` or `prod`, set by their
CDK stack. Each send includes the technical `ym_environment` tag. EventBridge
filters by environment, account and region; the consumer rechecks the envelope
environment before ingestion. Missing or mismatched SES environments fail
closed. Deploy sender, transformer and consumer together in standby before
activation. Historical untagged events need explicit operator reconciliation,
not an environment inferred from copied workspace identifiers.

SES tenant names are `ym-{environment}-{workspaceId}`, with a transactional
configuration set named `{tenantName}-txn`. Provisioning and sending use the same
UUID-validated naming contract. A stored account from another workspace or
environment, or an older unscoped tenant, is rejected before AWS access. Existing
accounts are never silently replaced by provisioning; reconcile legacy bindings
explicitly before enabling SES. These application checks do not create separate
AWS accounts or make a shared sending identity environment-specific.

The additional SES IAM restrictions were deployed **in standby** on September 10
under `a65f72d`. The [real probe](docs/ses-real-probe-2026-09-10.md) records 44
provisioning checks and 12 SendEmail checks in the dedicated test account (two
accepted simulator messages, not 56 deliveries). IAM tenant constraints and SES
identity membership provide distinct layers of enforcement. The
[IAM simulator](docs/ses-iam-certification-2026-09-07.md) still disagrees with ten
expected positive cases; its result is not green. Legacy identities require an
explicit ownership decision, and the complete application transport and ledger
still need certification. SES production approval is a separate prerequisite.

Email and customer-webhook queue jobs now require an explicit UUID workspace ID
alongside the message or delivery ID. Unknown fields and legacy unscoped payloads
are rejected; workers filter the initial database access by that workspace.
Deploy outbox, send and webhook workers together in standby. Before activating
transport, inventory queues and reconcile legacy jobs against their owned
database records; do not purge queues or add an unscoped compatibility fallback.
See the [September 11 certification and remaining blockers](docs/queue-workspace-certification-2026-09-11.md)
for this change's publication status.

The [real SES event transport probe](docs/ses-transport-certification-2026-09-11.md)
uses a separately gated stack in the dedicated test account. It found that
EventBridge emits an empty optional bounce field on Delivery events; the consumer
accepts that representation for non-bounce events without weakening workspace or
environment checks. The probe is not a full application/ledger certification.

`STRIPE_TAX_MODE` defaults to `unconfigured` and blocks Checkout. Set it to
`franchise_base` only after confirming that no active Stripe Tax registration
exists and that the business is legally eligible for the franchise en base. Set
it to `registered` only when an active Stripe Tax registration matches the real
tax registration. Postmark credentials are stored under:

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

See [architecture](docs/architecture.md), the [production runbook](docs/production-runbook.md)
and the dated [production/commercial GO checklist](docs/commercial-go-checklist-2026-08-18.md).
