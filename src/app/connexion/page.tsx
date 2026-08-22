import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { SignInPanel } from "@/components/auth/sign-in-panel";
import { env, isBetterAuthConfigured } from "@/lib/env";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { title: "Console en cours de configuration", text: "L’accès privé sera ouvert dès que les identifiants OAuth de production auront été installés." },
    en: { title: "Console setup in progress", text: "Private access will open once the production OAuth credentials have been installed." },
  });
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="grid w-full max-w-md place-items-center gap-8">
        <Link href={localizedPath(locale, "/")}><BrandMark className="text-xl" /></Link>
        {isBetterAuthConfigured() ? (
          <SignInPanel emailPasswordEnabled={env.BETTER_AUTH_EMAIL_PASSWORD_ENABLED === "true"} locale={locale} />
        ) : (
          <div className="w-full rounded-3xl border bg-white p-8 text-center shadow-xl">
            <h1 className="text-2xl font-semibold">{copy.title}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.text}</p>
          </div>
        )}
      </div>
    </main>
  );
}
