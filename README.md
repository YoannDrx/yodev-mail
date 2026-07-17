# VigieMail

VigieMail is a French, privacy-first email platform for small businesses and agencies. It combines marketing campaigns and a transactional API with Amazon SES tenant isolation, consent evidence, progressive quotas and transparent billing.

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

## Safety contract

- Every data query is scoped by the active Clerk organization workspace.
- A marketing email is queued only when consent, domain, subscription, suppression and quota checks all pass.
- API keys are shown once and stored as HMAC hashes.
- Queue bodies contain opaque IDs only.
- Stripe, SES and EventBridge events are idempotent.
- A complaint or reputation threshold can pause a workspace before remaining jobs are sent.

## External prerequisites

The application runs locally in demo mode without credentials. Real delivery requires a dedicated AWS account with SES production access in `eu-west-3`, a Clerk application, a Neon database, Stripe test/live keys and a Vercel project.
