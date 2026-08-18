"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function InvitationPanel({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const session = authClient.useSession();
  const [error, setError] = useState("");
  const callbackURL = `/invitation?id=${encodeURIComponent(invitationId)}`;

  async function signIn() {
    const result = await authClient.signIn.social({
      callbackURL,
      errorCallbackURL: `${callbackURL}&erreur=oauth`,
      provider: "google",
    });
    if (result.error) setError("La connexion Google n’a pas abouti.");
  }

  async function accept() {
    setError("");
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      setError("Cette invitation est invalide, expirée ou destinée à une autre adresse.");
      return;
    }
    const role = result.data?.invitation.role ?? "member";
    router.push(role.split(",").includes("owner") ? "/onboarding" : "/dashboard");
    router.refresh();
  }

  return (
    <div className="w-full rounded-3xl border bg-white p-8 shadow-xl">
      <p className="text-sm font-medium text-primary">INVITATION PRIVÉE</p>
      <h1 className="mt-2 text-3xl font-semibold">Rejoindre Mail by Yodev</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">Connectez-vous avec l’adresse exacte qui a reçu l’invitation.</p>
      {session.data ? (
        <Button className="mt-7 w-full" onClick={accept}>Accepter l’invitation</Button>
      ) : (
        <Button className="mt-7 w-full" onClick={signIn}>Continuer avec Google</Button>
      )}
      {error ? <p aria-live="polite" className="mt-4 text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
