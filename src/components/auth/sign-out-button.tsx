"use client";

import { useState } from "react";
import { useHydrated } from "@/components/auth/use-hydrated";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// Signs out and reloads the given same-origin page so server components see
// the anonymous state (e.g. to switch Google account on an invitation).
export function SignOutButton({
  label,
  pendingLabel,
  redirectTo,
  variant = "outline",
}: {
  label: string;
  pendingLabel: string;
  redirectTo: string;
  variant?: "outline" | "secondary" | "default";
}) {
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  return (
    <Button
      disabled={pending || !hydrated}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        window.location.assign(redirectTo);
      }}
      type="button"
      variant={variant}
    >
      <LogOut />
      {pending ? pendingLabel : label}
    </Button>
  );
}
