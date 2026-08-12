# Production runbook

## Mandatory preflight

- production branch and CI are green;
- a Neon restore branch exists and schema/table counters are exported;
- Postmark Platform is approved and the 28-day retention option is active;
- the Postmark Account Token exists in SSM without appearing in logs;
- Vercel, Clerk, Stripe, AWS and DNS inventories are exported without secret values;
- `SES_ENABLED=false` is present in Vercel Production and the production workload;
- `support@mail.yodev.fr` and `abuse@mail.yodev.fr` receive mail;
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
