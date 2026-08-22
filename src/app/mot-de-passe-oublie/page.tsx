import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { PasswordResetRequestPanel } from "@/components/auth/password-reset-panel";
import { env } from "@/lib/env";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  if (env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED !== "true") return null;
  const locale = await getLocale();
  const copy = localized(locale, { fr: { title: "Mot de passe oublié", text: "Le lien expire après quinze minutes." }, en: { title: "Forgot your password", text: "The link expires after fifteen minutes." } });
  return <main className="grid min-h-screen place-items-center p-6"><div className="grid w-full max-w-md gap-8"><Link className="justify-self-center" href={localizedPath(locale, "/")}><BrandMark /></Link><section className="rounded-3xl border bg-white p-8 shadow-xl"><h1 className="text-3xl font-semibold">{copy.title}</h1><p className="my-4 text-sm text-muted-foreground">{copy.text}</p><PasswordResetRequestPanel locale={locale} /></section></div></main>;
}
