"use client";

import { useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

export function AccountMenu() {
  const router = useRouter();
  const session = authClient.useSession();
  const organizations = authClient.useListOrganizations();
  const [message, setMessage] = useState("");
  const activeOrganizationId = (session.data?.session as { activeOrganizationId?: string } | undefined)?.activeOrganizationId;

  async function setActive(organizationId: string) {
    const result = await authClient.organization.setActive({ organizationId });
    if (result.error) {
      setMessage("Le changement de workspace a échoué.");
      return;
    }
    router.refresh();
  }

  async function addPasskey() {
    setMessage("");
    const result = await authClient.passkey.addPasskey({ name: "Passkey principale" });
    setMessage(result?.error ? "L’enregistrement de la passkey a échoué." : "Passkey enregistrée.");
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/connexion");
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {organizations.data?.length ? (
        <label className="sr-only" htmlFor="workspace-switcher">Workspace actif</label>
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
      <Button aria-label="Ajouter une passkey" onClick={addPasskey} size="icon" title="Ajouter une passkey" variant="ghost">
        <KeyRound />
      </Button>
      <Button aria-label="Se déconnecter" onClick={signOut} size="icon" title="Se déconnecter" variant="ghost">
        <LogOut />
      </Button>
      {message ? <span aria-live="polite" className="sr-only">{message}</span> : null}
    </div>
  );
}
