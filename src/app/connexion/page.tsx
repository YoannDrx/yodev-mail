import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { env, isBetterAuthConfigured } from "@/lib/env";

export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href="/"><BrandMark className="text-xl" /></Link>
        {isBetterAuthConfigured() ? (
          <SignInPanel emailPasswordEnabled={env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED === "true"} />
        ) : (
          <div className="w-full rounded-3xl border bg-white p-8 text-center shadow-xl">
            <h1 className="text-2xl font-semibold">Console en cours de configuration</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">L’accès privé sera ouvert dès que les identifiants OAuth de production auront été installés.</p>
          </div>
        )}
      </div>
    </main>
  );
}
