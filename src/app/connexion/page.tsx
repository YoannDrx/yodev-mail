import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { SignInProblemNotice } from "@/components/auth/sign-in-problem";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { safeRedirectPath, signInProblem } from "@/lib/auth-policy";
import { env, isBetterAuthConfigured } from "@/lib/env";
import { optionalPageUser } from "@/lib/page-auth";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getLocale()) === "fr" ? "Connexion" : "Sign in",
    robots: { index: false, follow: false },
  };
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const locale = await getLocale();
  const params = await searchParams;
  const problem = signInProblem({ error: params.error, erreur: params.erreur });
  const next = safeRedirectPath(params.next);
  const configured = isBetterAuthConfigured();
  const user = configured ? await optionalPageUser() : null;
  // A signed-in visitor has nothing to do here unless a problem must be explained.
  if (user && !problem) redirect(localizedPath(locale, next));

  const copy = localized(locale, {
    fr: { title: "Console en cours de configuration", text: "L’accès privé sera ouvert dès que les identifiants OAuth de production auront été installés.", signOut: "Se déconnecter", signingOut: "Déconnexion…" },
    en: { title: "Console setup in progress", text: "Private access will open once the production OAuth credentials have been installed.", signOut: "Sign out", signingOut: "Signing out…" },
  });
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href={localizedPath(locale, "/")}><BrandMark className="text-xl" /></Link>
        {problem ? (
          <SignInProblemNotice locale={locale} problem={problem}>
            {user ? <SignOutButton label={copy.signOut} pendingLabel={copy.signingOut} redirectTo={localizedPath(locale, "/connexion")} /> : null}
          </SignInProblemNotice>
        ) : null}
        {configured ? (
          <SignInPanel callbackURL={next} emailPasswordEnabled={env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED === "true"} locale={locale} />
        ) : (
          <div className="w-full rounded-md border bg-card p-8 text-center ">
            <h1 className="text-2xl font-semibold">{copy.title}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.text}</p>
          </div>
        )}
      </div>
    </main>
  );
}
