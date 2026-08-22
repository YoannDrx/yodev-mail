import type { Metadata } from "next";
import { Suspense } from "react";
import { DM_Sans, Fira_Code, Plus_Jakarta_Sans } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageSwitcher } from "@/components/language-switcher";
import { getLocale, getOriginalPathname } from "@/i18n/server";
import { localizedPath, stripLocale } from "@/i18n/config";
import "./globals.css";

const bodyFont = DM_Sans({
  variable: "--font-yodev-body",
  subsets: ["latin"],
});

const displayFont = Plus_Jakarta_Sans({
  variable: "--font-yodev-display",
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
      default: locale === "fr" ? "Mail by Yodev — Passerelle email transactionnelle gérée" : "Mail by Yodev — Managed transactional email gateway",
      template: "%s — Mail by Yodev",
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
      lang={locale}
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Suspense fallback={null}><LanguageSwitcher locale={locale} pathname={pathname} /></Suspense>
      </body>
    </html>
  );
}
