"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    fr: { oauthError: "La connexion n’a pas abouti. Vérifiez que vous disposez d’une invitation.", passkeyError: "Aucune passkey valide n’a été trouvée pour ce domaine.", credentialsError: "Identifiants invalides ou adresse non vérifiée.", eyebrow: "CONSOLE PRIVÉE", title: "Connexion à Mail by Yodev", intro: "L’accès est limité au compte administrateur et aux membres invités.", google: "Continuer avec Google", passkey: "Utiliser une passkey", email: "Adresse email", password: "Mot de passe", emailSignIn: "Se connecter par email", forgot: "Mot de passe oublié ?" },
    en: { oauthError: "Sign-in failed. Check that you have an invitation.", passkeyError: "No valid passkey was found for this domain.", credentialsError: "Invalid credentials or unverified email address.", eyebrow: "PRIVATE CONSOLE", title: "Sign in to Mail by Yodev", intro: "Access is limited to the administrator account and invited members.", google: "Continue with Google", passkey: "Use a passkey", email: "Email address", password: "Password", emailSignIn: "Sign in with email", forgot: "Forgot your password?" },
  });
  const localizedCallbackURL = localizedPath(locale, callbackURL);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function google() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.social({
      callbackURL: localizedCallbackURL,
      errorCallbackURL: `${localizedPath(locale, "/connexion")}?erreur=oauth`,
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

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await authClient.signIn.email({ email, password, callbackURL: localizedCallbackURL });
    if (result.error) {
      setError(copy.credentialsError);
      setPending(false);
    }
  }

  return (
    <div className="w-full rounded-3xl border bg-white p-8 shadow-xl">
      <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {copy.intro}
      </p>
      <Button className="mt-7 w-full" disabled={pending} onClick={google} type="button">
        {copy.google}
      </Button>
      <Button className="mt-3 w-full" disabled={pending} onClick={passkey} type="button" variant="outline">
        <KeyRound /> {copy.passkey}
      </Button>
      {emailPasswordEnabled ? (
        <form className="mt-6 grid gap-4 border-t pt-6" onSubmit={passwordSignIn}>
          <div className="grid gap-2">
            <Label htmlFor="email">{copy.email}</Label>
            <Input autoComplete="email" id="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{copy.password}</Label>
            <Input autoComplete="current-password" id="password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </div>
          <Button disabled={pending} type="submit" variant="secondary">{copy.emailSignIn}</Button>
          <Link className="text-center text-sm text-primary underline-offset-4 hover:underline" href={localizedPath(locale, "/mot-de-passe-oublie")}>{copy.forgot}</Link>
        </form>
      ) : null}
      {error ? <p aria-live="polite" className="mt-4 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
