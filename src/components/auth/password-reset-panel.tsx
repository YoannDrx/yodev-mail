"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordResetRequestPanel() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await authClient.requestPasswordReset({ email, redirectTo: "/reinitialiser-mot-de-passe" });
    setSent(true);
  }

  return sent ? (
    <p className="text-sm leading-6 text-muted-foreground">Si cette adresse est éligible, un lien temporaire vient d’être envoyé.</p>
  ) : (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2"><Label htmlFor="reset-email">Adresse email</Label><Input autoComplete="email" id="reset-email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /></div>
      <Button type="submit">Envoyer un lien temporaire</Button>
    </form>
  );
}

export function PasswordResetPanel({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setMessage("Ce lien est invalide ou expiré.");
      return;
    }
    router.push("/connexion?mot-de-passe=modifie");
    router.refresh();
  }

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-2"><Label htmlFor="new-password">Nouveau mot de passe</Label><Input autoComplete="new-password" id="new-password" minLength={12} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></div>
      <Button type="submit">Modifier le mot de passe</Button>
      {message ? <p aria-live="polite" className="text-sm text-destructive">{message}</p> : null}
    </form>
  );
}
