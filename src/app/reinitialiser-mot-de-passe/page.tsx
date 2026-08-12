import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { PasswordResetPanel } from "@/components/auth/password-reset-panel";
import { env } from "@/lib/env";

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED !== "true" || !token) notFound();
  return <main className="grid min-h-screen place-items-center p-6"><div className="grid w-full max-w-md gap-8"><Link className="justify-self-center" href="/"><BrandMark /></Link><section className="rounded-3xl border bg-white p-8 shadow-xl"><h1 className="text-3xl font-semibold">Nouveau mot de passe</h1><p className="my-4 text-sm text-muted-foreground">Utilisez au moins douze caractères uniques.</p><PasswordResetPanel token={token} /></section></div></main>;
}
