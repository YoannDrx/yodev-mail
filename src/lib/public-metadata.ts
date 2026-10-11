import type { Metadata } from "next";
import { localizedPath, stripLocale, type Locale } from "@/i18n/config";
import { absoluteUrl, siteConfig } from "@/lib/site-config";

/** hreflang alternates for a locale-free pathname, with the negotiating URL as x-default. */
export function localeAlternates(locale: Locale, pathname: string): NonNullable<Metadata["alternates"]> {
  const path = stripLocale(pathname);
  return {
    canonical: absoluteUrl(localizedPath(locale, path)),
    languages: {
      fr: absoluteUrl(localizedPath("fr", path)),
      en: absoluteUrl(localizedPath("en", path)),
      "x-default": absoluteUrl(path),
    },
  };
}

export function socialImage(locale: Locale) {
  return {
    url: absoluteUrl(`/opengraph-image?locale=${locale}`),
    width: 1200,
    height: 630,
    alt: locale === "fr"
      ? "Mail by Yodev : les emails de votre application, pris en charge."
      : "Mail by Yodev: your application’s emails, taken care of.",
  };
}

/** Distinct, localized metadata for an indexable public page. */
export function publicPageMetadata(
  locale: Locale,
  pathname: string,
  { title, description }: { title?: string; description: string },
): Metadata {
  const alternates = localeAlternates(locale, pathname);
  return {
    ...(title ? { title } : {}),
    description,
    alternates,
    openGraph: {
      type: "website",
      siteName: siteConfig.name,
      locale: locale === "fr" ? "fr_FR" : "en_GB",
      alternateLocale: locale === "fr" ? ["en_GB"] : ["fr_FR"],
      url: alternates.canonical as string,
      title: title ? `${title} | ${siteConfig.name}` : siteConfig.name,
      description,
      images: [socialImage(locale)],
    },
    twitter: { card: "summary_large_image" },
  };
}
