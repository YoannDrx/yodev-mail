"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { localized, localizedPath, type Locale } from "@/i18n/config";

export function PasswordResetRequestPanel({ locale }: { locale: Locale }) {
  const copy = localized(locale, {
    fr: { sent: "Si cette adresse est éligible, un lien temporaire vient d’être envoyé.", email: "Adresse email", submit: "Envoyer un lien temporaire" },
    en: { sent: "If this address is eligible, a temporary link has just been sent.", email: "Email address", submit: "Send a temporary link" },
  });
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await authClient.requestPasswordReset({ email, redirectTo: localizedPath(locale, "/reinitialiser-mot-de-passe") });
    setSent(true);
  }

  return sent ? (
    <p className="text-sm leading-6 text-muted-foreground">{copy.sent}</p>
  ) : (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2"><Label htmlFor="reset-email">{copy.email}</Label><Input autoComplete="email" id="reset-email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></div>
      <Button type="submit">{copy.submit}</Button>
    </form>
  );
}

export function PasswordResetPanel({ locale, token }: { locale: Locale; token: string }) {
  const copy = localized(locale, {
    fr: { invalid: "Ce lien est invalide ou expiré.", password: "Nouveau mot de passe", submit: "Modifier le mot de passe" },
    en: { invalid: "This link is invalid or has expired.", password: "New password", submit: "Change password" },
  });
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setMessage(copy.invalid);
      return;
    }
    router.push(`${localizedPath(locale, "/connexion")}?mot-de-passe=modifie`);
    router.refresh();
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2"><Label htmlFor="new-password">{copy.password}</Label><Input autoComplete="new-password" id="new-password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></div>
      <Button type="submit">{copy.submit}</Button>
      {message ? <p aria-live="polite" className="text-sm text-destructive">{message}</p> : null}
    </form>
  );
}
