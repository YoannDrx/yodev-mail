"use client"; // Error boundaries must be Client Components.

import { useSyncExternalStore } from "react";
import { defaultLocale, localeFromPathname, localized, localizedPath, type Locale } from "@/i18n/config";
import "./globals.css";

const subscribe = () => () => {};

/**
 * Replaces the root layout when it fails, so it renders its own document and
 * cannot rely on request headers, providers or the theme class.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const locale = useSyncExternalStore<Locale>(subscribe, () => localeFromPathname(window.location.pathname) ?? defaultLocale, () => defaultLocale);
  const copy = localized(locale, {
    fr: { title: "Service momentanément indisponible", text: "Mail by Yodev n’a pas pu afficher cette page. Réessayez dans un instant ; si le problème persiste, contactez le support en indiquant la référence ci-dessous.", retry: "Réessayer", home: "Retour à l’accueil", reference: "Référence" },
    en: { title: "Service temporarily unavailable", text: "Mail by Yodev could not display this page. Try again in a moment; if the problem persists, contact support with the reference below.", retry: "Try again", home: "Back to home", reference: "Reference" },
  });
  return (
    <html lang={locale}>
      <body className="min-h-full bg-background text-foreground antialiased">
        <title>{copy.title}</title>
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-5 p-6" id="main-content">
          <p className="font-mono text-sm text-muted-foreground">Mail by Yodev</p>
          <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
          <p className="text-muted-foreground" role="alert">{copy.text}</p>
          {error.digest ? <p className="font-mono text-xs text-muted-foreground">{copy.reference} : {error.digest}</p> : null}
          <div className="flex flex-wrap gap-3">
            <button className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" onClick={() => retry()} type="button">{copy.retry}</button>
            {/* A full navigation reloads the root layout instead of reusing the failed tree. */}
            <a className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium" href={localizedPath(locale, "/")}>{copy.home}</a>
          </div>
        </main>
      </body>
    </html>
  );
}
