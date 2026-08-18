"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SignInPanel({
  callbackURL = "/dashboard",
  emailPasswordEnabled,
}: {
  callbackURL?: string;
  emailPasswordEnabled: boolean;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function google() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.social({
      callbackURL,
      errorCallbackURL: "/connexion?erreur=oauth",
      provider: "google",
    });
    if (result.error) {
      setError("La connexion n’a pas abouti. Vérifiez que vous disposez d’une invitation.");
      setPending(false);
    }
  }

  async function passkey() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.passkey({ autoFill: false });
    if (result?.error) {
      setError("Aucune passkey valide n’a été trouvée pour ce domaine.");
      setPending(false);
      return;
    }
    window.location.assign(callbackURL);
  }

  async function passwordSignIn(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    const result = await authClient.signIn.email({ email, password, callbackURL });
    if (result.error) {
      setError("Identifiants invalides ou adresse non vérifiée.");
      setPending(false);
    }
  }

  return (
    <div className="w-full rounded-3xl border bg-white p-8 shadow-xl">
      <p className="text-sm font-medium text-primary">CONSOLE PRIVÉE</p>
      <h1 className="mt-2 text-3xl font-semibold">Connexion à Mail by Yodev</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        L’accès est limité au compte administrateur et aux membres invités.
      </p>
      <Button className="mt-7 w-full" disabled={pending} onClick={google} type="button">
        Continuer avec Google
      </Button>
      <Button className="mt-3 w-full" disabled={pending} onClick={passkey} type="button" variant="outline">
        <KeyRound /> Utiliser une passkey
      </Button>
      {emailPasswordEnabled ? (
        <form className="mt-6 grid gap-4 border-t pt-6" onSubmit={passwordSignIn}>
          <div className="grid gap-2">
            <Label htmlFor="email">Adresse email</Label>
            <Input autoComplete="email" id="email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Mot de passe</Label>
            <Input autoComplete="current-password" id="password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
          </div>
          <Button disabled={pending} type="submit" variant="secondary">Se connecter par email</Button>
          <Link className="text-center text-sm text-primary underline-offset-4 hover:underline" href="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
        </form>
      ) : null}
      {error ? <p aria-live="polite" className="mt-4 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
