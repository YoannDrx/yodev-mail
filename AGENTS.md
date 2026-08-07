# Mail by Yodev Guidance

- Mail by Yodev is a French multi-tenant email SaaS built on Next.js 16, Clerk Organizations, Neon/Drizzle, Stripe and Amazon SES v2.
- Read `README.md`, `package.json`, the target file and the nearest schema/test before non-trivial edits.
- Keep Server Components as the default. Client components are limited to interactive controls.
- Every database access must receive and filter by an explicit `workspaceId`.
- Every Server Action and Route Handler revalidates authentication, authorization and workspace ownership.
- Marketing sends require positive eligibility, a visible unsubscribe link and RFC 8058 headers. Never silently upgrade consent during imports.
- Never place email addresses or content in AWS queue bodies, SES tags or operational logs.
- Use committed Drizzle migrations; never use schema push in production.
- Run `npm run check` and the smallest relevant Playwright flow before publishing.
