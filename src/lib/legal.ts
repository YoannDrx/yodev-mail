import type { Locale } from "@/i18n/config";
import { betaPlanDisplay } from "@/lib/plan-display";
import { siteConfig, vatStatement } from "@/lib/site-config";

/** A section body is one paragraph, or a list rendered as bullet points. */
export type LegalSection = [title: string, body: string | readonly string[]];
export type LegalPage = { title: string; intro: string; sections: LegalSection[] };
export type LegalFacts = ReturnType<typeof legalFacts>;

/** Facts shared by both languages, derived from the single sources of truth. */
export function legalFacts(locale: Locale) {
  return { plan: betaPlanDisplay(locale), vat: vatStatement[locale], support: siteConfig.supportEmail, abuse: siteConfig.abuseEmail };
}
