import type { MetadataRoute } from "next";

const publicPaths = ["", "/fonctionnalites", "/tarifs", "/delivrabilite", "/conformite", "/docs", "/anti-abus", "/confidentialite", "/cgu", "/mentions-legales", "/dpa", "/sous-traitants", "/sla"];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.flatMap((path, index) => ["fr", "en"].map((locale) => ({
    url: `https://mail.yodev.fr/${locale}${path}`,
    alternates: {
      languages: {
        fr: `https://mail.yodev.fr/fr${path}`,
        en: `https://mail.yodev.fr/en${path}`,
      },
    },
    changeFrequency: index === 0 ? "weekly" as const : "monthly" as const,
    priority: index === 0 ? 1 : 0.7,
  })));
}
