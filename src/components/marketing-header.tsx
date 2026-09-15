import { NavigationDisclosure } from "@/brand/navigation-disclosure";
import { Suspense } from "react";
import { LanguageSwitcher } from "./language-switcher";
import { AppearanceToggle } from "@/components/appearance";
import { Menu } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function MarketingHeader() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { home: "Yodev Mail, accueil", features: "Fonctionnalités", deliverability: "Délivrabilité", pricing: "Tarifs", signIn: "Connexion", join: "Rejoindre la bêta" },
    en: { home: "Yodev Mail, home", features: "Features", deliverability: "Deliverability", pricing: "Pricing", signIn: "Sign in", join: "Join the beta" },
  });
  return <header className="sticky top-0 z-40 border-b bg-background "><div className="mx-auto flex flex-wrap min-h-20 gap-3 py-3 max-w-7xl items-center justify-between px-5">
    <Link href={localizedPath(locale, "/")} aria-label={copy.home}><BrandMark /></Link>
    <nav className="hidden items-center gap-7 text-sm text-muted-foreground xl:flex"><Link href={localizedPath(locale, "/fonctionnalites")}>{copy.features}</Link><Link href={localizedPath(locale, "/delivrabilite")}>{copy.deliverability}</Link><Link href={localizedPath(locale, "/docs")}>API</Link><Link href={localizedPath(locale, "/tarifs")}>{copy.pricing}</Link></nav>
    <div className="flex max-w-full flex-wrap items-center gap-2"><Suspense fallback={null}><LanguageSwitcher locale={locale} pathname="/" /></Suspense><AppearanceToggle locale={locale}/><NavigationDisclosure className="y-mobile-menu xl:hidden" label="Menu" icon={<Menu size={20}/>}><nav><Link href={localizedPath(locale,"/fonctionnalites")}>{copy.features}</Link><Link href={localizedPath(locale,"/delivrabilite")}>{copy.deliverability}</Link><Link href={localizedPath(locale,"/docs")}>API</Link><Link href={localizedPath(locale,"/tarifs")}>{copy.pricing}</Link><Link href={localizedPath(locale,"/connexion")}>{copy.signIn}</Link></nav></NavigationDisclosure><Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href={localizedPath(locale, "/connexion")}>{copy.signIn}</Link></Button><Button asChild className="hidden sm:inline-flex"><Link href={localizedPath(locale, "/inscription")}>{copy.join}</Link></Button></div>
  </div></header>;
}
