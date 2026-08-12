import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/fonctionnalites", "/tarifs", "/delivrabilite", "/conformite", "/docs"],
        disallow: ["/admin", "/dashboard", "/onboarding", "/api", "/v1"],
      },
    ],
    sitemap: "https://mail.yodev.fr/sitemap.xml",
    host: "https://mail.yodev.fr",
  };
}
