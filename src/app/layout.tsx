import { AppearanceProvider, AppearanceToggle } from "@/components/appearance";
import type { Metadata } from "next";
import { Suspense } from "react";
import { DM_Sans, Fira_Code } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale, getOriginalPathname } from "@/i18n/server";
import { localizedPath, stripLocale } from "@/i18n/config";
import "./globals.css";

const bodyFont = DM_Sans({
  variable: "--font-yodev-body",
  subsets: ["latin"],
});


const monoFont = Fira_Code({
  variable: "--font-yodev-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const [locale, originalPathname] = await Promise.all([getLocale(), getOriginalPathname()]);
  const pathname = stripLocale(originalPathname);
  const canonicalPath = localizedPath(locale, pathname);
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
    title: {
      default: locale === "fr" ? "Yodev Mail — Passerelle email transactionnelle gérée" : "Yodev Mail — Managed transactional email gateway",
      template: "%s — Yodev Mail",
    },
    description: locale === "fr"
      ? "Une API d’envoi transactionnel opérée par Yodev pour des applications, domaines et cas d’usage vérifiés."
      : "A managed transactional email API for verified applications, domains, and use cases.",
    alternates: {
      canonical: canonicalPath,
      languages: {
        fr: localizedPath("fr", pathname),
        en: localizedPath("en", pathname),
      },
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, pathname] = await Promise.all([getLocale(), getOriginalPathname()]);
  return (
    <html
      lang={locale} suppressHydrationWarning data-product="mail"
      className={`${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppearanceProvider>
          {['/connexion', '/inscription', '/invitation', '/mot-de-passe-oublie', '/reinitialiser-mot-de-passe', '/onboarding', '/admin'].includes(stripLocale(pathname)) && <div className="flex justify-end gap-2 border-b px-5 py-2"><Suspense fallback={null}><LanguageSwitcher locale={locale} pathname={pathname}/></Suspense><AppearanceToggle locale={locale}/></div>}
          <TooltipProvider>{children}</TooltipProvider>
        </AppearanceProvider>
      </body>
    </html>
  );
}
