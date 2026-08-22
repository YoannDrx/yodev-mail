"use client";

import { Languages } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { localizedPath, type Locale } from "@/i18n/config";

export function LanguageSwitcher({ locale, pathname }: { locale: Locale; pathname: string }) {
  const clientPathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.size ? `?${searchParams.toString()}` : "";
  const currentPathname = clientPathname || pathname;
  return (
    <nav
      aria-label={locale === "fr" ? "Choisir la langue" : "Choose language"}
      className="fixed bottom-4 right-4 z-50 flex items-center gap-1 rounded-full border bg-white/95 p-1 text-xs font-semibold shadow-lg backdrop-blur"
    >
      <Languages aria-hidden="true" className="ml-2 size-4 text-muted-foreground" />
      {(["fr", "en"] as const).map((targetLocale) => (
        <a
          aria-current={locale === targetLocale ? "page" : undefined}
          className={`rounded-full px-2.5 py-1.5 transition ${locale === targetLocale ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          href={`${localizedPath(targetLocale, currentPathname)}${query}`}
          hrefLang={targetLocale}
          key={targetLocale}
          lang={targetLocale}
        >
          {targetLocale.toUpperCase()}
        </a>
      ))}
    </nav>
  );
}
