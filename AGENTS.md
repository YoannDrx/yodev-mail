# Mail by Yodev Guidance

- Mail by Yodev is a French multi-tenant transactional email gateway built on Next.js 16, Better Auth Organizations, Neon/Drizzle, Stripe, Postmark and Amazon SES v2.
- Read `README.md`, `package.json`, the target file and the nearest schema/test before non-trivial edits.
- Keep Server Components as the default. Client components are limited to interactive controls.
- Every database access must receive and filter by an explicit `workspaceId`.
- Every Server Action and Route Handler revalidates authentication, authorization and workspace ownership.
- Marketing, newsletters, cold email, contact imports and campaign sending are outside the product and must remain unavailable.
- Never place email addresses or content in AWS queue bodies, SES tags or operational logs.
- Use committed Drizzle migrations; never use schema push in production.
- Run `npm run check` and the smallest relevant Playwright flow before publishing.

## AWS Guidance

- Prefer the AWS MCP Server for AWS interactions - it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- Before starting a task, check whether a relevant AWS skill is available.
  Load the skill with `retrieve_skill` and prefer its guidance over
  general knowledge.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

### Secret Safety

- MUST load the `creating-secrets-using-best-practices` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.
