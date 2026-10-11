"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentLocale } from "@/components/use-document-locale";
import { localized, localizedPath } from "@/i18n/config";

/**
 * Localized fallback for route error boundaries. The server error message is
 * never shown (production replaces it anyway); the digest lets support find
 * the matching server log.
 */
export function ErrorFallback({ digest, retry, home, standalone = false }: { digest?: string; retry: () => void; home: "/" | "/dashboard"; standalone?: boolean }) {
  const locale = useDocumentLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const copy = localized(locale, {
    fr: { title: "Une erreur est survenue", text: "Cette page n’a pas pu s’afficher. Réessayez ; si le problème persiste, contactez le support en indiquant la référence ci-dessous.", retry: "Réessayer", home: home === "/" ? "Retour à l’accueil" : "Retour à la vue d’ensemble", reference: "Référence" },
    en: { title: "Something went wrong", text: "This page could not be displayed. Try again; if the problem persists, contact support with the reference below.", retry: "Try again", home: home === "/" ? "Back to home" : "Back to overview", reference: "Reference" },
  });
  const content = <>
    <title>{copy.title}</title>
    <h1 className="text-3xl font-semibold tracking-tight outline-none" ref={heading} tabIndex={-1}>{copy.title}</h1>
    <p className="text-muted-foreground" role="alert">{copy.text}</p>
    {digest ? <p className="font-mono text-xs text-muted-foreground">{copy.reference} : {digest}</p> : null}
    <div className="flex flex-wrap gap-3">
      <Button className="h-10" onClick={() => retry()} type="button"><RotateCcw />{copy.retry}</Button>
      <Button asChild className="h-10" variant="outline"><Link href={localizedPath(locale, home)}>{copy.home}</Link></Button>
    </div>
  </>;
  return standalone
    ? <main className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-1 flex-col justify-center gap-5 p-6 py-16" id="main-content" tabIndex={-1}>{content}</main>
    : <section className="mx-auto grid max-w-2xl gap-5 py-12">{content}</section>;
}
