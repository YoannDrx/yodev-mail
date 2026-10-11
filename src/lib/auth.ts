import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { passkey } from "@better-auth/passkey";
import { and, eq, gt, sql } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin, organization } from "better-auth/plugins";
import { requireDb } from "@/db";
import * as schema from "@/db/schema";
import { authInvitations } from "@/db/schema";
import { reconcileAcceptedOwnerInvitation } from "@/features/onboarding/reconcile-owner";
import { sendAuthEmail } from "@/lib/auth-emails";
import { disabledAuthPaths, INVITATION_REQUIRED } from "@/lib/auth-policy";
import { env } from "@/lib/env";
import { emitOperationalMetric } from "@/lib/operational-metric";

type MailAuth = ReturnType<typeof createAuth>;

let singleton: MailAuth | undefined;

function appUrl() {
  return (env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

function trustedOrigins() {
  const configured = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return Array.from(new Set([appUrl(), ...configured]));
}

/**
 * The platform administrator's Google address. Required by the auth path only:
 * the Lambda workers load the same env module without setting it.
 */
export function bootstrapEmail() {
  const value = env.AUTH_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (!value) throw new Error("AUTH_BOOTSTRAP_EMAIL is required for authentication.");
  return value;
}

export async function mayCreateUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === bootstrapEmail()) return true;
  const invitation = await requireDb()
    .select({ id: authInvitations.id })
    .from(authInvitations)
    .where(
      and(
        sql`lower(${authInvitations.email}) = ${normalizedEmail}`,
        eq(authInvitations.status, "pending"),
        gt(authInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return invitation.length === 1;
}

function createAuth() {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET is required for authentication.");
  }
  if (!env.BETTER_AUTH_GOOGLE_CLIENT_ID || !env.BETTER_AUTH_GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth credentials are required for authentication.");
  }
  bootstrapEmail();

  const baseURL = appUrl();
  const hostname = new URL(baseURL).hostname;
  const emailPasswordEnabled = env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED === "true";

  return betterAuth({
    appName: "Mail by Yodev",
    baseURL,
    secret: env.BETTER_AUTH_SECRET,
    // Every OAuth failure Better Auth cannot attribute to a request (missing or
    // expired state, cancelled consent) lands on the sign-in page with its code
    // instead of `/?error=`. The proxy adds the visitor's locale.
    onAPIError: { errorURL: `${baseURL}/connexion` },
    disabledPaths: disabledAuthPaths({ emailPasswordEnabled }),
    database: drizzleAdapter(requireDb(), {
      provider: "pg",
      schema,
      usePlural: false,
    }),
    user: { modelName: "authUsers" },
    session: {
      modelName: "authSessions",
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 60 * 24,
    },
    account: {
      modelName: "authAccounts",
      encryptOAuthTokens: true,
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        allowDifferentEmails: false,
        allowUnlinkingAll: false,
      },
    },
    verification: {
      modelName: "authVerifications",
      storeIdentifier: "hashed",
    },
    socialProviders: {
      google: {
        clientId: env.BETTER_AUTH_GOOGLE_CLIENT_ID,
        clientSecret: env.BETTER_AUTH_GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    emailAndPassword: {
      enabled: emailPasswordEnabled,
      // Local accounts are never self-registered: an unverified password
      // account could otherwise pre-empt the invited owner's Google sign-in.
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 60 * 15,
      revokeSessionsOnPasswordReset: true,
      // Better Auth only checks that this callback exists before sending a
      // reset email, so it must not exist while passwords are disabled.
      sendResetPassword: emailPasswordEnabled
        ? async ({ user, url }) => {
            await sendAuthEmail({
              actionUrl: url,
              intro: "Une réinitialisation de mot de passe a été demandée pour votre compte.",
              kind: "password_reset",
              to: user.email,
            });
          }
        : undefined,
    },
    emailVerification: {
      expiresIn: 60 * 15,
      sendOnSignUp: emailPasswordEnabled,
      sendOnSignIn: emailPasswordEnabled,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail({
          actionUrl: url,
          intro: "Confirmez votre adresse avant d’accéder à votre espace privé.",
          kind: "email_verification",
          to: user.email,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!(await mayCreateUser(user.email))) {
              // Better Auth turns this message into the `error` code of the
              // OAuth redirect, so it must stay a stable machine code.
              throw new APIError("FORBIDDEN", {
                code: INVITATION_REQUIRED,
                message: INVITATION_REQUIRED,
              });
            }
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "authRateLimits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60 * 15, max: 5 },
        "/sign-up/email": { window: 60 * 15, max: 5 },
        "/forget-password": { window: 60 * 15, max: 5 },
        "/request-password-reset": { window: 60 * 15, max: 5 },
      },
    },
    trustedOrigins: trustedOrigins(),
    advanced: {
      cookiePrefix: "yodev_mail",
      crossSubDomainCookies: { enabled: false },
      useSecureCookies: baseURL.startsWith("https://"),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: baseURL.startsWith("https://"),
        path: "/",
      },
    },
    plugins: [
      organization({
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        creatorRole: "owner",
        membershipLimit: 3,
        requireEmailVerificationOnInvitation: true,
        schema: {
          organization: { modelName: "authOrganizations" },
          member: { modelName: "authMembers" },
          invitation: { modelName: "authInvitations" },
          session: { fields: { activeOrganizationId: "activeOrganizationId" } },
        },
        organizationHooks: {
          afterAcceptInvitation: async ({ invitation, user }) => {
            if (!invitation.role.split(",").map((role) => role.trim()).includes("owner")) {
              return;
            }
            try {
              await reconcileAcceptedOwnerInvitation({
                invitationId: invitation.id,
                organizationId: invitation.organizationId,
                userId: user.id,
                actorUserId: user.id,
              });
            } catch {
              emitOperationalMetric("ClientProvisioningReconciliationFailed");
            }
          },
        },
        sendInvitationEmail: async ({ email, id, organization: invitedOrganization }) => {
          await sendAuthEmail({
            actionUrl: `${baseURL}/fr/invitation?id=${encodeURIComponent(id)}`,
            intro: `Vous êtes invité à rejoindre ${invitedOrganization.name}.`,
            kind: "organization_invitation",
            to: email,
          });
        },
      }),
      admin({
        defaultRole: "user",
        adminRoles: ["admin"],
        defaultBanReason: "Compte suspendu par Yodev",
      }),
      passkey({
        rpName: "Mail by Yodev",
        rpID: hostname,
        origin: baseURL,
        schema: { passkey: { modelName: "authPasskeys" } },
        registration: { requireSession: true },
      }),
      nextCookies(),
    ],
  });
}

export function getAuth() {
  singleton ??= createAuth();
  return singleton;
}

export type MailAuthSession = Awaited<ReturnType<MailAuth["api"]["getSession"]>>;
