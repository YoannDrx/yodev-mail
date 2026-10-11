import type { Locale } from "@/i18n/config";

const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://mail.yodev.fr").replace(/\/+$/, "");

export const siteConfig = {
  name: "Mail by Yodev",
  title: "Mail by Yodev — Passerelle email transactionnelle gérée",
  description:
    "Une API transactionnelle opérée par Yodev pour des applications, domaines et cas d’usage vérifiés.",
  marketingUrl: process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://yodev.fr/fr/mail",
  appUrl,
  apiUrl: "https://api.mail.yodev.fr",
  supportEmail: "support@yodev.fr",
  salesEmail: "hello@yodev.fr",
  abuseEmail: "abuse@yodev.fr",
  legalUpdatedAt: { fr: "11 octobre 2026", en: "October 11, 2026" } satisfies Record<Locale, string>,
} as const;

/**
 * Single VAT statement used by every public and legal page.
 * It mirrors the current legal notice (VAT franchise, art. 293 B CGI) and must
 * be confirmed by the owner before live checkout; change it here only.
 */
export const vatStatement = {
  fr: "TVA non applicable, article 293 B du Code général des impôts.",
  en: "VAT not applicable under Article 293 B of the French General Tax Code.",
} as const satisfies Record<Locale, string>;

/** Absolute URL on the application host, used by the sitemap, robots and metadata. */
export function absoluteUrl(pathname: string) {
  return `${siteConfig.appUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}
