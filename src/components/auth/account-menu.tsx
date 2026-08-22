"use client";

import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { Locale } from "@/i18n/config";
import { localized, localizedPath } from "@/i18n/config";

export function AccountMenu({ locale }: { locale: Locale }) {
  const router = useRouter();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const [message, setMessage] = useState("");
  const activeOrganizationId = (session.data?.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId;
  const copy = localized(locale, { fr: { switchFailed: "Le changement de workspace a échoué.", passkeyName: "Passkey principale", passkeyFailed: "L’enregistrement de la passkey a échoué.", passkeySaved: "Passkey enregistrée.", active: "Workspace actif", add: "Ajouter une passkey", signOut: "Se déconnecter" }, en: { switchFailed: "Workspace switching failed.", passkeyName: "Primary passkey", passkeyFailed: "Passkey registration failed.", passkeySaved: "Passkey registered.", active: "Active workspace", add: "Add a passkey", signOut: "Sign out" } });

  async function setActive(organizationId: string) {
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error) {
      setMessage(copy.switchFailed);
      return;
    }
    router.refresh();
  }

  async function addPasskey() {
    setMessage("");
    const result = await authClient.passkey.addPasskey({ name: copy.passkeyName });
    setMessage(result?.error ? copy.passkeyFailed : copy.passkeySaved);
  }

  async function signOut() {
    await authClient.signOut();
    router.push(localizedPath(locale, "/connexion"));
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {organizations.data?.length ? (
        <label className="sr-only" htmlFor="workspace-switcher">{copy.active}</label>
      ) : null}
      {organizations.data?.length ? (
        <select
          className="h-9 max-w-48 rounded-md border bg-white px-3 text-sm"
          id="workspace-switcher"
          onChange={(event) => setActive(event.target.value)}
          value={activeOrganizationId ?? ""}
        >
          {organizations.data.map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
        </select>
      ) : null}
      <Button aria-label={copy.add} onClick={addPasskey} size="icon" title={copy.add} variant="ghost">
        <KeyRound />
      </Button>
      <Button aria-label={copy.signOut} onClick={signOut} size="icon" title={copy.signOut} variant="ghost">
        <LogOut />
      </Button>
      {message ? <span aria-live="polite" className="sr-only">{message}</span> : null}
    </div>
  );
}
