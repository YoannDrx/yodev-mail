import type { MetadataRoute } from "next";
import { locales } from "@/i18n/config";
import { absoluteUrl } from "@/lib/site-config";

const publicPaths = ["", "/fonctionnalites", "/tarifs", "/delivrabilite", "/conformite", "/docs", "/contact", "/inscription", "/anti-abus", "/confidentialite", "/cgu", "/mentions-legales", "/dpa", "/sous-traitants", "/sla"];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.flatMap((path, index) => locales.map((locale) => ({
    url: absoluteUrl(`/${locale}${path}`),
    alternates: {
      languages: {
        fr: absoluteUrl(`/fr${path}`),
        en: absoluteUrl(`/en${path}`),
        "x-default": absoluteUrl(path || "/"),
      },
    },
    changeFrequency: index === 0 ? "weekly" as const : "monthly" as const,
    priority: index === 0 ? 1 : 0.7,
  })));
}
