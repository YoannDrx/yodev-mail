"use client";

import { useState } from "react";
import { useHydrated } from "@/components/auth/use-hydrated";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { FormStatus } from "@/components/form-status";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { localized, localizedPath, type Locale } from "@/i18n/config";

export type InvitationState = "anonymous" | "ready" | "mismatch" | "unavailable";

export function InvitationPanel({
  invitationId,
  invitedEmail,
  locale,
  organizationName,
  signedInEmail,
  state,
}: {
  invitationId: string;
  invitedEmail?: string;
  locale: Locale;
  organizationName?: string;
  signedInEmail?: string;
  state: InvitationState;
}) {
  const copy = localized(locale, {
    fr: { googleError: "La connexion Google n’a pas pu démarrer. Réessayez.", invitationError: "Cette invitation est invalide, expirée ou destinée à une autre adresse.", eyebrow: "INVITATION PRIVÉE", title: "Rejoindre Yodev Mail", join: "Vous êtes invité à rejoindre", intro: "Connectez-vous avec l’adresse exacte qui a reçu l’invitation.", accept: "Accepter l’invitation", accepting: "Acceptation…", google: "Continuer avec Google", otherMethod: "Autre méthode de connexion", mismatchTitle: "Ce compte ne correspond pas à l’invitation", mismatch: (signedIn: string, invited: string) => `Vous êtes connecté avec ${signedIn}, mais cette invitation est destinée à ${invited}. Déconnectez-vous, puis reconnectez-vous avec le compte Google invité.`, signOut: "Se déconnecter et changer de compte", signingOut: "Déconnexion…", unavailableTitle: "Invitation indisponible", unavailable: "Cette invitation a expiré, a déjà été utilisée ou a été annulée. Demandez au propriétaire du workspace de vous en envoyer une nouvelle.", signIn: "Aller à la connexion" },
    en: { googleError: "Google sign-in could not start. Please try again.", invitationError: "This invitation is invalid, expired, or intended for another address.", eyebrow: "PRIVATE INVITATION", title: "Join Yodev Mail", join: "You are invited to join", intro: "Sign in with the exact address that received the invitation.", accept: "Accept invitation", accepting: "Accepting…", google: "Continue with Google", otherMethod: "Other sign-in method", mismatchTitle: "This account does not match the invitation", mismatch: (signedIn: string, invited: string) => `You are signed in as ${signedIn}, but this invitation is for ${invited}. Sign out, then sign in again with the invited Google account.`, signOut: "Sign out and switch account", signingOut: "Signing out…", unavailableTitle: "Invitation unavailable", unavailable: "This invitation has expired, was already used, or was cancelled. Ask the workspace owner to send you a new one.", signIn: "Go to sign-in" },
  });
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const invitationPath = `${localizedPath(locale, "/invitation")}?id=${encodeURIComponent(invitationId)}`;

  async function signIn() {
    setPending(true);
    setError("");
    const result = await authClient.signIn.social({
      callbackURL: invitationPath,
      errorCallbackURL: `${invitationPath}&erreur=oauth`,
      provider: "google",
    });
    if (result.error) {
      setError(copy.googleError);
      setPending(false);
    }
  }

  async function accept() {
    setPending(true);
    setError("");
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      setError(copy.invitationError);
      setPending(false);
      return;
    }
    const role = result.data?.invitation.role ?? "member";
    router.push(localizedPath(locale, role.split(",").includes("owner") ? "/onboarding" : "/dashboard"));
    router.refresh();
  }

  return (
    <div className="w-full rounded-md border bg-card p-8 ">
      <p className="text-sm font-medium text-primary">{copy.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold">{copy.title}</h1>
      {organizationName ? (
        <p className="mt-3 text-sm leading-6">{copy.join} <strong>{organizationName}</strong>.</p>
      ) : null}
      {state === "unavailable" ? (
        <div className="mt-4" role="alert">
          <p className="font-medium">{copy.unavailableTitle}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.unavailable}</p>
          <Button asChild className="mt-6 w-full" variant="outline">
            <Link href={localizedPath(locale, "/connexion")}>{copy.signIn}</Link>
          </Button>
        </div>
      ) : state === "mismatch" ? (
        <div className="mt-4" role="alert">
          <p className="font-medium">{copy.mismatchTitle}</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.mismatch(signedInEmail ?? "", invitedEmail ?? "")}</p>
          <div className="mt-6 grid">
            <SignOutButton label={copy.signOut} pendingLabel={copy.signingOut} redirectTo={invitationPath} />
          </div>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.intro}</p>
          {state === "ready" ? (
            <Button className="mt-7 w-full" disabled={pending || !hydrated} onClick={accept} type="button">{pending ? copy.accepting : copy.accept}</Button>
          ) : (
            <>
              <Button className="mt-7 w-full" disabled={pending || !hydrated} onClick={signIn} type="button">{copy.google}</Button>
              <Link
                className="mt-4 block text-center text-sm text-primary underline-offset-4 hover:underline"
                href={`${localizedPath(locale, "/connexion")}?next=${encodeURIComponent(invitationPath)}`}
              >
                {copy.otherMethod}
              </Link>
            </>
          )}
        </>
      )}
      <FormStatus className="mt-4" message={error} ok={false} />
    </div>
  );
}
