import { AppearanceProvider, AppearanceToggle } from "@/components/appearance";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { DM_Sans, Fira_Code } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale, getOriginalPathname } from "@/i18n/server";
import { localized, stripLocale } from "@/i18n/config";
import { localeAlternates, socialImage } from "@/lib/public-metadata";
import { siteConfig } from "@/lib/site-config";
import "./globals.css";

const bodyFont = DM_Sans({
  variable: "--font-yodev-body",
  subsets: ["latin"],
});


const monoFont = Fira_Code({
  variable: "--font-yodev-mono",
  subsets: ["latin"],
});

// Pages that render their own <main> without the marketing header: the root
// layout gives them the skip-link target. /admin and /onboarding get it from
// their own layouts.
const standalonePaths = ["/connexion", "/inscription", "/invitation", "/mot-de-passe-oublie", "/reinitialiser-mot-de-passe"];
const toolbarPaths = [...standalonePaths, "/onboarding", "/admin"];
// Authentication flows are never indexed; /inscription stays public (beta application).
const noindexPaths = standalonePaths.filter((path) => path !== "/inscription");

export async function generateMetadata(): Promise<Metadata> {
  const [locale, originalPathname] = await Promise.all([getLocale(), getOriginalPathname()]);
  const description = localized(locale, {
    fr: "Une API d’envoi transactionnel opérée par Yodev pour des applications, domaines et cas d’usage vérifiés.",
    en: "A managed transactional email API for verified applications, domains, and use cases.",
  });
  const route = stripLocale(originalPathname);
  return {
    ...(noindexPaths.includes(route) ? { robots: { index: false, follow: false } } : {}),
    metadataBase: new URL(siteConfig.appUrl),
    applicationName: siteConfig.name,
    title: {
      default: localized(locale, {
        fr: "Mail by Yodev — Passerelle email transactionnelle gérée",
        en: "Mail by Yodev — Managed transactional email gateway",
      }),
      template: `%s | ${siteConfig.name}`,
    },
    description,
    alternates: localeAlternates(locale, route),
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      locale: locale === "fr" ? "fr_FR" : "en_GB",
      description,
      images: [socialImage(locale)],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, pathname, requestHeaders] = await Promise.all([getLocale(), getOriginalPathname(), headers()]);
  // Set by src/proxy.ts with the per-request CSP; next-themes needs it for its inline script.
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const route = stripLocale(pathname);
  const standalone = standalonePaths.includes(route);
  return (
    <html
      lang={locale} suppressHydrationWarning data-product="mail"
      className={`${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-primary-foreground"
        >
          {localized(locale, { fr: "Aller au contenu principal", en: "Skip to main content" })}
        </a>
        <AppearanceProvider nonce={nonce}>
          {toolbarPaths.includes(route) && <div className="flex justify-end gap-2 border-b px-5 py-2"><Suspense fallback={null}><LanguageSwitcher locale={locale} pathname={pathname}/></Suspense><AppearanceToggle locale={locale}/></div>}
          <TooltipProvider>{standalone ? <div id="main-content" tabIndex={-1} className="flex flex-1 flex-col outline-none">{children}</div> : children}</TooltipProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
