import type { Metadata } from "next";
import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: localized(locale, { fr: "Page introuvable", en: "Page not found" }),
    robots: { index: false },
  };
}

export default async function NotFound() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { title: "Page introuvable", text: "Cette page n’existe pas ou n’est plus disponible. Vérifiez l’adresse ou repartez de l’une de ces pages.", home: "Accueil", dashboard: "Console", docs: "Documentation de l’API", navigation: "Pages utiles" },
    en: { title: "Page not found", text: "This page does not exist or is no longer available. Check the address or start again from one of these pages.", home: "Home", dashboard: "Console", docs: "API documentation", navigation: "Useful pages" },
  });
  return <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6 py-16" id="main-content" tabIndex={-1}>
    {/* notFound() thrown by a page keeps that page's metadata: React hoists this title instead. */}
    <title>{`${copy.title} — Yodev Mail`}</title>
    <Link aria-label={copy.home} className="w-fit" href={localizedPath(locale, "/")}><BrandMark /></Link>
    <p className="font-mono text-sm text-muted-foreground">404</p>
    <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
    <p className="text-muted-foreground">{copy.text}</p>
    <nav aria-label={copy.navigation} className="flex flex-wrap gap-3">
      <Button asChild className="h-10"><Link href={localizedPath(locale, "/")}>{copy.home}</Link></Button>
      <Button asChild className="h-10" variant="outline"><Link href={localizedPath(locale, "/dashboard")}>{copy.dashboard}</Link></Button>
      <Button asChild className="h-10" variant="outline"><Link href={localizedPath(locale, "/docs")}>{copy.docs}</Link></Button>
    </nav>
  </main>;
}
