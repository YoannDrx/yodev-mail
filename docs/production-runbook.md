# Production runbook

## Mandatory preflight

- production branch and CI are green;
- a Neon restore branch exists and schema/table counters are exported;
- Postmark Platform is approved and the 28-day retention option is active;
- the Postmark Account Token exists in SSM without appearing in logs;
- Vercel, Better Auth, Stripe, AWS and DNS inventories are exported without secret values;
- `SES_ENABLED=false` is present in Vercel Production and the production workload;
- `YODEV_MAIL_SES_ENABLED=false` is used for ordinary CDK synthesis and deployment;
- `STRIPE_TAX_MODE=unconfigured` keeps Checkout closed until the tax regime is independently confirmed;
- `support@yodev.fr` and `abuse@yodev.fr` receive mail;
- public legal pages contain the final RNE/RCS wording from the official INPI extract.
- the AWS account has completed the one-time “GuardDuty Malware Protection for S3 only” enrollment before `YODEV_MAIL_GUARDDUTY_ENABLED=true` is used or `AWS_ATTACHMENTS_BUCKET` is exposed to Vercel;
- migration `0009_concerned_miracleman.sql` has passed on a fresh Neon child branch and duplicate-domain/admin-review preflight queries return zero rows;
- every production feature gate remains `false` before its explicit activation step;
- CloudTrail is logging, log validation is enabled, the root-account alarm is `OK`, the operations SNS subscription is confirmed and the account budget is accepted;

## Deployment

1. Run `npm run check`, `npm run test:e2e` and `npm run infra:synth`.
2. Run `cdk diff YodevMailProd` with `YODEV_MAIL_AWS_ACTIVE_ENVIRONMENTS=prod` and `YODEV_MAIL_VERCEL_OIDC_PROVIDER_ARN` set to the existing provider, then review replacements and IAM changes. Never deploy a production template synthesized in standby mode.
3. Deploy the AWS foundation/workload with SES disabled.
4. Apply Drizzle migrations to a production clone, verify the existing workspace/subscription, perform a restore exercise, then apply to production.
5. Deploy Vercel and verify host routing on `mail.yodev.fr` and `api.mail.yodev.fr`.
6. Approve the internal workspace, profile and template.
7. Provision the Yodev domain, publish the displayed DNS records and wait for real verification.
8. Keep all new gates closed and verify that live acceptance, checkout, commercial provisioning, raw email and attachments return their documented unavailable state.
9. Enable `COMMERCIAL_ONBOARDING_ENABLED` only in Preview, provision two synthetic organizations and pass the full workspace A/B authorization suite. Close it again after the test.
10. Verify Stripe checkout, webhooks, portal and the per-message meter in test mode. Reconcile every `unknown` or `unreportable` usage job before proceeding.
11. Send controlled live canaries to Gmail, Outlook and iCloud only after enabling `LIVE_EMAIL_ACCEPTANCE_ENABLED`; verify delivery, bounce simulation, customer webhook, usage ledger, empty queues and no duplicate. Keep the previous consumer transport available.
12. Execute the authorized live Stripe purchase/refund certification, then open `LIVE_CHECKOUT_ENABLED` and `STRIPE_USAGE_REPORTING_ENABLED` only if tax, invoice, portal and webhook evidence is complete.
13. Enable attachments only after GuardDuty/S3 proof. Enable raw email only after an explicit product decision and dedicated abuse tests; it is not required for launch.
14. Invite the first pilot only after all launch gates are green, then observe for 72 hours.

## Better Auth cutover

1. Add the Preview-only Google client ID and secret, `BETTER_AUTH_SECRET`, trusted origins and bootstrap address. Do not reuse production OAuth credentials locally.
2. Deploy `codex/mail-better-auth-launch` to Preview and test `/api/auth/get-session`, Google sign-in, invitation acceptance, passkey enrollment/authentication, workspace switching and logout.
3. Confirm that a non-invited address cannot register and that bootstrap binds exactly one existing workspace with an administrator.
4. Run workspace A/B authorization tests against domains, keys, messages, profiles, templates and webhooks.
5. Merge to `main`, wait for the production deployment, replay smoke tests, then remove Clerk variables. Never remove Clerk before the production session proof.

## Internal pilot entitlement

1. Confirm migrations through `0009_concerned_miracleman.sql` on a Neon restore branch and record the migration journal.
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

## Gate activation and rollback

Record the operator, timestamp, commit, environment, expected evidence and rollback before changing a gate. Change one gate per deployment and run a negative test before the positive test. If any P0/P1, duplicate, cross-tenant access, unexplained DLQ, ambiguous provider result or billing mismatch appears, close `LIVE_EMAIL_ACCEPTANCE_ENABLED`, `LIVE_CHECKOUT_ENABLED`, `STRIPE_USAGE_REPORTING_ENABLED` and `COMMERCIAL_ONBOARDING_ENABLED` immediately. Never replay a message or usage job in `unknown` without reconciling it against the provider first.

Checkout Sessions expire after one hour. Closing `LIVE_CHECKOUT_ENABLED` prevents new sessions but does not revoke a URL already issued ; list and expire every pending YoDevMail session in Stripe during an emergency rollback, then verify the corresponding `checkout.session.expired` webhooks before declaring checkout closed.

The required opening order is: commercial onboarding in Preview, live acceptance for internal canaries, Stripe checkout certification, Stripe usage reporting, then commercial onboarding in production. Opening usage requires a CDK deployment synthesized with `YODEV_MAIL_STRIPE_USAGE_REPORTING_ENABLED=true`, which writes `STRIPE_USAGE_REPORTING_ENABLED=true` only into the active usage Lambda; the synthesis input defaults to false and standby remains closed. Attachments are independent and stay closed until GuardDuty is proven. `SES_ENABLED` stays false unless an active certification workload is deliberately synthesized with `YODEV_MAIL_SES_ENABLED=true`.

Checkout and portal use the restricted key exposed to the web application as
`STRIPE_SECRET_KEY`. Usage reporting uses a different restricted key stored only
as the encrypted SSM parameter
`/yodev-mail-{environment}/runtime/stripe-usage-secret-key`; the Lambda loads it
as `STRIPE_USAGE_SECRET_KEY`. Never grant meter-event write access to the web
runtime key and never install the usage key in Vercel.

## Stripe tax regime

Checkout is fail-closed while `STRIPE_TAX_MODE=unconfigured`.

- `franchise_base`: confirm the absence of a voluntary VAT option and threshold
  overrun with the business tax account or SIE. Stripe must have no active Tax
  registration. Automatic Tax remains off and the invoice footer must contain
  the legally applicable franchise wording.
- `registered`: verify the real VAT registration first, then create the matching
  Stripe Tax registration. Automatic Tax is enabled only in this mode.
- Never create a Stripe Tax registration as a substitute for a real tax
  registration and never rewrite historical invoices when changing mode.

For a future `franchise_base` to `registered` transition, close Checkout, record
the effective date and jurisdiction, configure and verify the Stripe Tax
registration, update the invoice footer, set `STRIPE_TAX_MODE=registered`, run
`npm run stripe:verify`, complete a sandbox invoice and only then reopen
Checkout. Preserve all earlier invoices unchanged.

## Backup, recovery and incident objectives

- Target RPO: 15 minutes for application data, subject to the verified Neon recovery window; Stripe/Postmark remain the external reconciliation sources.
- Target RTO: 4 hours for a critical control-plane incident during the private beta.
- Before each migration, create a named Neon restore branch and export only schema/counters, never message content.
- Quarterly, restore the latest recoverable point to an isolated branch, run the health/schema/A-B suites and record duration and result.
- Preserve Stripe event IDs, provider message IDs and opaque audit correlations needed for reconciliation. Do not restore already-accepted messages into an active sender without first closing live acceptance and draining workers.
- An incident owner closes consequential gates, assesses tenant scope, preserves management audit evidence, communicates through the documented support channel and records the decision to reopen.

These are operational objectives for the beta, not evidence that Neon currently meets them; the first measured restore exercise is a launch gate.

## Stripe usage reconciliation

Monitor `stripe_usage_report_jobs` by status. `pending` should be short-lived; a stale `processing`, any `unknown`, or any `unreportable` is an alert and blocks invoice certification. Compare the frozen customer/subscription, accepted timestamp and opaque identifier with Stripe without creating a second meter event. Mark a job reported only after positive Stripe evidence; otherwise resolve billing manually and preserve the audit trail. Stripe meter identifiers are not treated as a permanent exactly-once guarantee.

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
