# Mail by Yodev

Mail by Yodev is a French, privacy-first email platform for small businesses and agencies. It combines marketing campaigns and a transactional API with Amazon SES tenant isolation, consent evidence, progressive quotas and transparent billing.

## Stack

- Next.js 16 / React 19 / TypeScript
- Clerk Organizations
- Neon Postgres / Drizzle ORM
- Amazon SES v2, SQS, Lambda, EventBridge Scheduler and S3
- Stripe Billing
- Tailwind CSS 4 / shadcn/ui
- Vitest / Playwright / AWS CDK

## Commands

```bash
npm run dev
npm run check
npm run test:e2e
npm run db:generate
npm run db:migrate
npm run infra:synth
npm run stripe:sync -- --dry-run
```

Copy `.env.example` to `.env.local` for local development. Vercel Development, Preview and Production values are managed separately. AWS access from Vercel uses OIDC and an IAM role, not static access keys.

AWS workers are deployed in zero-cost standby mode by default: SQS polling,
scheduled jobs and billable CloudWatch alarms remain disabled. Activate a tested
environment explicitly when delivery is needed:

```bash
YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS=prod npm run infra:deploy:prod
```

During the VigieMail-to-Yodev coexistence window, reuse the Vercel OIDC provider
owned by the legacy foundation stack instead of attempting to create a duplicate:

```bash
export YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN="arn:aws:iam::<account-id>:oidc-provider/oidc.vercel.com/yoanndrxs-projects"
npm run infra:deploy:foundation
```

Keep the legacy foundation stack until the provider has been formally retained
and imported into `YodevMailFoundation`; deleting its owning stack earlier would
break Vercel authentication for both generations of workloads.

Runtime worker secrets live in standard-tier SSM `SecureString` parameters under
`/yodev-mail-{environment}/runtime/`; this avoids recurring Secrets Manager storage
charges. Production activation retains ten CloudWatch alarms, the account-wide
always-free allowance.

## Safety contract

- Every data query is scoped by the active Clerk organization workspace.
- A marketing email is queued only when consent, domain, subscription, suppression and quota checks all pass.
- API keys are shown once and stored as HMAC hashes.
- Queue bodies contain opaque IDs only.
- Stripe, SES and EventBridge events are idempotent.
- A complaint or reputation threshold can pause a workspace before remaining jobs are sent.

## External prerequisites

The application runs locally in demo mode without credentials. Real delivery requires a dedicated AWS account with SES production access in `eu-west-3`, a Clerk application, a Neon database, Stripe test/live keys and a Vercel project.
