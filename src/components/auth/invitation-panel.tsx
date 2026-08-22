"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { localized, localizedPath, type Locale } from "@/i18n/config";

export function InvitationPanel({ invitationId, locale }: { invitationId: string; locale: Locale }) {
  const copy = localized(locale, {
    fr: { googleError: "La connexion Google n’a pas abouti.", invitationError: "Cette invitation est invalide, expirée ou destinée à une autre adresse.", eyebrow: "INVITATION PRIVÉE", title: "Rejoindre Mail by Yodev", intro: "Connectez-vous avec l’adresse exacte qui a reçu l’invitation.", accept: "Accepter l’invitation", google: "Continuer avec Google" },
    en: { googleError: "Google sign-in failed.", invitationError: "This invitation is invalid, expired, or intended for another address.", eyebrow: "PRIVATE INVITATION", title: "Join Mail by Yodev", intro: "Sign in with the exact address that received the invitation.", accept: "Accept invitation", google: "Continue with Google" },
  });
  const router = useRouter();
  const session = authClient.useSession();
  const [error, setError] = useState("");
  const callbackURL = `${localizedPath(locale, "/invitation")}?id=${encodeURIComponent(invitationId)}`;

  async function signIn() {
    const result = await authClient.signIn.social({
      callbackURL,
      errorCallbackURL: `${callbackURL}&erreur=oauth`,
      provider: "google",
    });
    if (result.error) setError(copy.googleError);
  }

  async function accept() {
    setError("");
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      setError(copy.invitationError);
      return;
    }
    const role = result.data?.invitation.role ?? "member";
    router.push(localizedPath(locale, role.split(",").includes("owner") ? "/onboarding" : "/dashboard"));
    router.refresh();
  }

  return (
    <div className="w-full rounded-3xl border bg-white p-8 shadow-xl">
      <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.intro}</p>
      {session.data ? (
        <Button className="mt-7 w-full" onClick={accept}>{copy.accept}</Button>
      ) : (
        <Button className="mt-7 w-full" onClick={signIn}>{copy.google}</Button>
      )}
      {error ? <p aria-live="polite" className="mt-4 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
