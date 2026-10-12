import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { PasswordResetRequestPanel } from "@/components/auth/password-reset-panel";
import { env } from "@/lib/env";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: (await getLocale()) === "fr" ? "Mot de passe oublié" : "Forgot password",
    robots: { index: false, follow: false },
  };
}

export default async function Page() {
  // Passwords are disabled by default: the reset flow must not exist at all.
  if (env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED !== "true") notFound();
  const locale = await getLocale();
  const copy = localized(locale, { fr: { title: "Mot de passe oublié", text: "Le lien expire après quinze minutes." }, en: { title: "Forgot your password", text: "The link expires after fifteen minutes." } });
  return <main className="grid min-h-screen place-items-center p-6"><div className="grid w-full max-w-md gap-8"><Link className="justify-self-center" href={localizedPath(locale, "/")}><BrandMark /></Link><section className="rounded-md border bg-card p-8 "><h1 className="text-3xl font-semibold">{copy.title}</h1><p className="my-4 text-sm text-muted-foreground">{copy.text}</p><PasswordResetRequestPanel locale={locale} /></section></div></main>;
}
