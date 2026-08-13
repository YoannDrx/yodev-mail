# Production runbook

## Mandatory preflight

- production branch and CI are green;
- a Neon restore branch exists and schema/table counters are exported;
- Postmark Platform is approved and the 28-day retention option is active;
- the Postmark Account Token exists in SSM without appearing in logs;
- Vercel, Better Auth, Stripe, AWS and DNS inventories are exported without secret values;
- `SES_ENABLED=false` is present in Vercel Production and the production workload;
- `support@yodev.fr` and `abuse@yodev.fr` receive mail;
- public legal pages contain the final RNE/RCS wording from the official INPI extract.
- the AWS account has completed the one-time “GuardDuty Malware Protection for S3 only” enrollment before `YODEV_MAIL_GUARDDUTY_ENABLED=true` is used or `AWS_ATTACHMENTS_BUCKET` is exposed to Vercel;

## Deployment

1. Run `npm run check`, `npm run test:e2e` and `npm run infra:synth`.
2. Run `cdk diff YodevMailProd` with `YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS=prod` and `YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN` set to the existing provider, then review replacements and IAM changes. Never deploy a production template synthesized in standby mode.
3. Deploy the AWS foundation/workload with SES disabled.
4. Apply Drizzle migrations to a production clone, verify the existing workspace/subscription, then apply to production.
5. Deploy Vercel and verify host routing on `mail.yodev.fr` and `api.mail.yodev.fr`.
6. Approve the internal workspace, profile and template.
7. Provision the Yodev domain, publish the displayed DNS records and wait for real verification.
8. Send canaries to Gmail, Outlook and iCloud; verify delivery, test bounce, customer webhook and usage ledger.
9. Create the private Stripe subscription and verify the meter in test before live mode.
10. Invite only the first pilot after all conditions are green.

## Better Auth cutover

1. Add the Preview-only Google client ID and secret, `BETTER_AUTH_SECRET`, trusted origins and bootstrap address. Do not reuse production OAuth credentials locally.
2. Deploy `codex/mail-better-auth-launch` to Preview and test `/api/auth/get-session`, Google sign-in, invitation acceptance, passkey enrollment/authentication, workspace switching and logout.
3. Confirm that a non-invited address cannot register and that bootstrap binds exactly one existing workspace with an administrator.
4. Run workspace A/B authorization tests against domains, keys, messages, profiles, templates and webhooks.
5. Merge to `main`, wait for the production deployment, replay smoke tests, then remove Clerk variables. Never remove Clerk before the production session proof.

## Internal pilot entitlement

1. Apply migration `0008_empty_ben_grimm.sql` first on a Neon restore branch.
2. Approve the workspace in the admin console.
3. Use the admin action “Pilote 30 jours”. The action refuses unapproved workspaces, caps duration at 90 days and records `internal_canary` without changing Stripe status.
4. Verify the expiration in both admin and billing pages. Revoke it immediately after the canary or when Stripe becomes active.

## Postmark activation evidence

Without printing account or Server tokens, record account approval/billing/retention, Servers and their `DeliveryType`, domains, streams, webhooks and suppressions. Production requires a Live Server; a Sandbox Server must be rejected because its type is immutable. Confirm `outbound`, open tracking off, link tracking `None`, Delivery/Bounce/SpamComplaint enabled and `IncludeContent=false`.

The Developer plan limited to 100 emails per month is a development/testing plan, not the production billing gate. Obtain explicit budget approval before selecting a paid plan, then record the plan, renewal date, payment status and retention. As observed on 13 August 2026, the first displayed paid tier is 10,000 emails for 15 USD per month.

Before activation, verify `yodev.fr` DKIM, `pm-bounces.yodev.fr`, DMARC, the stored Server ID and the SSM parameter names. Exercise a simulated timeout, 429, 5xx and definitive 4xx against the development Server. Never output parameter values.

## `yodev-ads` canary

1. Do not apply `0032_daffy_drax.sql` or `0033_melted_naoko.sql` alone. The production branch observed on 13 August 2026 stops at `0005`, so replay and review `0006` through `0033` in order, first on `backup-pre-yodev-mail-canary-20260813`/a fresh child clone, then during a controlled production maintenance window. The full chain has passed on `br-dawn-block-awatm9cb`. Verify 34 journal entries afterward; only the system DB role may read/insert/delete the minimal event table, and the opaque provider message ID must appear on the completed job attempt.
2. Configure `YODEV_MAIL_API_URL`, a test key, the approved template ID and a distinct webhook secret. Keep `OPERATIONS_EMAIL_PROVIDER=resend`.
3. Point the Mail by Yodev endpoint to `https://ads.yodev.fr/api/webhooks/yodev-mail` and send with the test key. Expect `simulated`, no Postmark call, no billable usage and no send outbox.
4. Replace only the key with a live key scoped to `emails:send` and `emails:read`, then set `OPERATIONS_EMAIL_PROVIDER=yodev_mail`. Only `job_dead_letter`, `stripe_webhook_failed` and `mutation_ambiguous` use this path.
5. Prove `email.sent`, `email.delivered`, hard bounce, soft bounce, complaint injection, suppression before provider and an intentionally failing customer webhook.
6. Verify Gmail, Outlook and iCloud, empty queues, empty DLQs, no `unknown`, no duplicate and no personal data in logs.
7. Observe 72 hours. Go requires zero P0/P1, duplicate, cross-tenant read, unexplained DLQ or queue age above five minutes.
8. Rollback is manual: set `OPERATIONS_EMAIL_PROVIDER=resend` and redeploy. Keep the Resend key for seven stable days and until no pending operations job depends on it.

## AWS read-only audit after `aws login`

In `eu-west-3`, capture `sesv2 get-account`, identities, DKIM/MAIL FROM, configuration sets, tenants, suppression state and quotas; CloudFormation stacks/drift; Lambda functions/event source mappings/concurrency; all queues/DLQs/redrive policies; EventBridge schedules; alarms; IAM/OIDC; CloudTrail and the existing Support case. Confirm production remains `SES_ENABLED=false` and that no passive template was deployed as active.

Do not retrieve or print SecureString values. Use the application’s runtime parameter resolution for functional tests. Run `cdk diff YodevMailProd` only with the existing OIDC provider ARN and `YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS=prod`.

## SES sandbox and later request

Sandbox proof is limited to verified recipients and the SES mailbox simulator. Prove DKIM 2048, custom MAIL FROM, DMARC and EventBridge → SQS → Lambda for delivery, bounce, complaint, reject, late, duplicate and reversed events. Production access is requested honestly as `TRANSACTIONAL` only after at least 30 clean days of Postmark evidence. A rejection does not trigger another region/account and does not block Postmark.

## Provider switch

1. Provision the secondary binding without activating it.
2. Publish and verify all DNS records.
3. Run an internal test.
4. Stop new acceptance for the domain and drain the current queue.
5. Atomically deactivate the old binding and activate the new one.
6. Send a canary and reopen acceptance.
7. Observe for 72 hours; retain the former binding disabled for seven days.

Never switch a message already in `sending`, `sent` or `unknown`, and never run old and new producers concurrently during rollback.

## SES evidence gate

Do not submit another AWS production-access request until the product has run transaction-only traffic for at least 30 clean days with multiple verified pilots. Attach public legal/anti-abuse pages, review screenshots, real anonymized metrics, DKIM/DMARC proof, suspension tests, event-flow diagrams and examples of approved transactional categories. AWS approval is an external decision and is not a launch dependency.
