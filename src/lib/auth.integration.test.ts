import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

// env.ts parses process.env when first imported: configure a local auth first.
vi.hoisted(() => {
  Object.assign(process.env, {
    AUTH_BOOTSTRAP_EMAIL: "bootstrap-admin@example.test",
    BETTER_AUTH_EMAIL_PASSWORD_ENABLED: "false",
    BETTER_AUTH_GOOGLE_CLIENT_ID: "local-integration.invalid",
    BETTER_AUTH_GOOGLE_CLIENT_SECRET: "local-only-not-a-google-credential",
    BETTER_AUTH_SECRET: "integration-secret-integration-secret-0123456789",
    BETTER_AUTH_TRUSTED_ORIGINS: "",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  });
});
vi.mock("server-only", () => ({}));

import { databasePool, requireDb } from "@/db/runtime";
import { authInvitations, authOrganizations, authUsers } from "@/db/schema";
import { getAuth } from "@/lib/auth";
import { INVITATION_REQUIRED } from "@/lib/auth-policy";
import { POST as routePost } from "@/app/api/auth/[...all]/route";

const db = requireDb();
const createdEmails: string[] = [];
const organizationIds: string[] = [];

afterAll(async () => {
  if (createdEmails.length) await db.delete(authUsers).where(inArray(authUsers.email, createdEmails));
  if (organizationIds.length) await db.delete(authOrganizations).where(inArray(authOrganizations.id, organizationIds));
  await databasePool!.end();
});

const base = "http://localhost:3000/api/auth";

describe("invitation-only account creation", () => {
  it("refuses a non-invited Google identity with the stable INVITATION_REQUIRED code", async () => {
    const context = await getAuth().$context;
    const email = `stranger-${randomUUID()}@example.test`;
    await expect(context.internalAdapter.createUser({ email, emailVerified: true, name: "Stranger" }))
      .rejects.toMatchObject({ body: { code: INVITATION_REQUIRED, message: INVITATION_REQUIRED } });
    expect(await db.select().from(authUsers).where(inArray(authUsers.email, [email]))).toHaveLength(0);
  });

  it("accepts an address with a pending, unexpired invitation", async () => {
    const context = await getAuth().$context;
    const organizationId = randomUUID();
    organizationIds.push(organizationId);
    const email = `invited-${randomUUID()}@example.test`;
    const inviterEmail = `inviter-${randomUUID()}@example.test`;
    createdEmails.push(email, inviterEmail);
    const [inviter] = await db.insert(authUsers).values({ id: randomUUID(), email: inviterEmail, emailVerified: true, name: "Inviter" }).returning();
    await db.insert(authOrganizations).values({ id: organizationId, name: "Invited org", slug: organizationId });
    await db.insert(authInvitations).values({
      id: randomUUID(),
      organizationId,
      email,
      role: "member",
      status: "pending",
      expiresAt: new Date(Date.now() + 60_000),
      inviterId: inviter.id,
    });
    await expect(context.internalAdapter.createUser({ email: email.toUpperCase(), emailVerified: true, name: "Invited" }))
      .resolves.toMatchObject({ email });
  });
});

describe("OAuth failures land on the sign-in page", () => {
  it("redirects an invalid OAuth state to /connexion instead of /?error=", async () => {
    const response = await getAuth().handler(new Request(`${base}/callback/google?error=access_denied&state=invalid`));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe("/connexion");
    expect(location.searchParams.get("error")).toBe("state_mismatch");
  });

  it("sends Better Auth's own error page to /connexion too", async () => {
    const response = await getAuth().handler(new Request(`${base}/error?error=state_not_found`));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("http://localhost:3000/connexion?error=state_not_found");
  });
});

describe("closed endpoints", () => {
  const post = (path: string) => new Request(`${base}${path}`, {
    body: JSON.stringify({ email: "target@example.test", organizationId: randomUUID(), role: "owner" }),
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    method: "POST",
  });

  it.each([
    "/organization/invite-member",
    "/organization/update",
    "/organization/update-member-role",
    "/admin/impersonate-user",
    "/sign-up/email",
    "/request-password-reset",
  ])("Better Auth itself answers 404 for %s", async (path) => {
    expect((await getAuth().handler(post(path))).status).toBe(404);
  });

  it.each([
    "/organization/invite-member",
    "//organization/invite-member",
    "/organization/invite-member/",
    "/reset-password/synthetic-token",
  ])("the route handler answers 404 for %s", async (path) => {
    expect((await routePost(post(path))).status).toBe(404);
  });

  it("does not define a password reset sender while passwords are disabled", async () => {
    const context = await getAuth().$context;
    expect(context.options.emailAndPassword?.sendResetPassword).toBeUndefined();
    expect(context.options.emailAndPassword?.disableSignUp).toBe(true);
  });
});
