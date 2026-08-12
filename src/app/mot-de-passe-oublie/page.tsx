import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { PasswordResetRequestPanel } from "@/components/auth/password-reset-panel";
import { env } from "@/lib/env";

export default function Page() {
  if (env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED !== "true") return null;
  return <main className="grid min-h-screen place-items-center p-6"><div className="grid w-full max-w-md gap-8"><Link className="justify-self-center" href="/"><BrandMark /></Link><section className="rounded-3xl border bg-white p-8 shadow-xl"><h1 className="text-3xl font-semibold">Mot de passe oublié</h1><p className="my-4 text-sm text-muted-foreground">Le lien expire après quinze minutes.</p><PasswordResetRequestPanel /></section></div></main>;
}
