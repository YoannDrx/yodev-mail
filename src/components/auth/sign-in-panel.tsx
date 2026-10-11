"use client";

import { useState } from "react";
import { useHydrated } from "@/components/auth/use-hydrated";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormStatus } from "@/components/form-status";
import { localized, localizedPath, type Locale } from "@/i18n/config";

export function SignInPanel({
  callbackURL = "/dashboard",
  emailPasswordEnabled,
  locale,
}: {
  callbackURL?: string;
  emailPasswordEnabled: boolean;
  locale: Locale;
}) {
  const copy = localized(locale, {
    fr: { oauthError: "La connexion n’a pas abouti. Vérifiez que vous disposez d’une invitation.", passkeyError: "Aucune passkey valide n’a été trouvée pour ce domaine.", credentialsError: "Identifiants invalides ou adresse non vérifiée.", eyebrow: "CONSOLE PRIVÉE", title: "Connexion à Yodev Mail", intro: "L’accès est limité au compte administrateur et aux membres invités.", google: "Continuer avec Google", passkey: "Utiliser une passkey", email: "Adresse email", password: "Mot de passe", emailSignIn: "Se connecter par email", forgot: "Mot de passe oublié ?" },
    en: { oauthError: "Sign-in failed. Check that you have an invitation.", passkeyError: "No valid passkey was found for this domain.", credentialsError: "Invalid credentials or unverified email address.", eyebrow: "PRIVATE CONSOLE", title: "Sign in to Yodev Mail", intro: "Access is limited to the administrator account and invited members.", google: "Continue with Google", passkey: "Use a passkey", email: "Email address", password: "Password", emailSignIn: "Sign in with email", forgot: "Forgot your password?" },
  });
  const localizedCallbackURL = localizedPath(locale, callbackURL);
  // Keep the requested page if Google sends the visitor back with an error.
  const errorCallbackURL = `${localizedPath(locale, "/connexion")}?erreur=oauth${
    callbackURL === "/dashboard" ? "" : `&next=${encodeURIComponent(callbackURL)}`
  }`;
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function google() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.social({
      callbackURL: localizedCallbackURL,
      errorCallbackURL,
      provider: "google",
    });
    if (result.error) {
      setError(copy.oauthError);
      setPending(false);
    }
  }

  async function passkey() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.passkey({ autoFill: false });
    if (result?.error) {
      setError(copy.passkeyError);
      setPending(false);
      return;
    }
    window.location.assign(localizedCallbackURL);
  }

  // Read the fields from the form itself: a password manager or a fast user may
  // fill them before hydration, when React state would still be empty.
  async function passwordSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    const result = await authClient.signIn.email({
      email: String(fields.get("email") ?? ""),
      password: String(fields.get("password") ?? ""),
      callbackURL: localizedCallbackURL,
    });
    if (result.error) {
      setError(copy.credentialsError);
      setPending(false);
    }
  }

  return (
    <div className="w-full rounded-md border bg-card p-8 ">
      <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {copy.intro}
      </p>
      <Button className="mt-7 w-full" disabled={pending || !hydrated} onClick={google} type="button">
        {copy.google}
      </Button>
      <Button className="mt-3 w-full" disabled={pending || !hydrated} onClick={passkey} type="button" variant="outline">
        <KeyRound /> {copy.passkey}
      </Button>
      {emailPasswordEnabled ? (
        // POST so that a submit before hydration never puts the password in the URL.
        <form className="mt-6 grid gap-4 border-t pt-6" method="post" onSubmit={passwordSignIn}>
          <div className="grid gap-2">
            <Label htmlFor="email">{copy.email}</Label>
            <Input autoComplete="email" id="email" name="email" required type="email" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{copy.password}</Label>
            <Input autoComplete="current-password" id="password" minLength={12} name="password" required type="password" />
          </div>
          <Button disabled={pending || !hydrated} type="submit" variant="secondary">{copy.emailSignIn}</Button>
          <Link className="text-center text-sm text-primary underline-offset-4 hover:underline" href={localizedPath(locale, "/mot-de-passe-oublie")}>{copy.forgot}</Link>
        </form>
      ) : null}
      <FormStatus className="mt-4" message={error} ok={false} />
    </div>
  );
}
