"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { localized, localizedPath, type Locale } from "@/i18n/config";

/** Visible sign-out control for pages without the dashboard account menu. */
export function SignOutButton({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const copy = localized(locale, { fr: { label: "Se déconnecter", pending: "Déconnexion…" }, en: { label: "Sign out", pending: "Signing out…" } });
  async function signOut() {
    setPending(true);
    try {
      await authClient.signOut();
      router.push(localizedPath(locale, "/connexion"));
      router.refresh();
    } finally {
      setPending(false);
    }
  }
  return <Button disabled={pending} onClick={signOut} type="button" variant="outline"><LogOut />{pending ? copy.pending : copy.label}</Button>;
}
