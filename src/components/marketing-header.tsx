import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function MarketingHeader() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { home: "Mail by Yodev, accueil", features: "Fonctionnalités", deliverability: "Délivrabilité", pricing: "Tarifs", signIn: "Connexion", join: "Rejoindre la bêta" },
    en: { home: "Mail by Yodev, home", features: "Features", deliverability: "Deliverability", pricing: "Pricing", signIn: "Sign in", join: "Join the beta" },
  });
  return <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-xl"><div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5">
    <Link href={localizedPath(locale, "/")} aria-label={copy.home}><BrandMark /></Link>
    <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex"><Link href={localizedPath(locale, "/fonctionnalites")}>{copy.features}</Link><Link href={localizedPath(locale, "/delivrabilite")}>{copy.deliverability}</Link><Link href={localizedPath(locale, "/docs")}>API</Link><Link href={localizedPath(locale, "/tarifs")}>{copy.pricing}</Link></nav>
    <div className="flex items-center gap-2"><Button asChild variant="ghost" className="hidden sm:inline-flex"><Link href={localizedPath(locale, "/connexion")}>{copy.signIn}</Link></Button><Button asChild><Link href={localizedPath(locale, "/inscription")}>{copy.join}</Link></Button></div>
  </div></header>;
}
