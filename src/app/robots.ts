import type { MetadataRoute } from "next";
import { locales } from "@/i18n/config";
import { absoluteUrl, siteConfig } from "@/lib/site-config";

/** Private or transactional human routes; every one is served under /fr and /en. */
const privateRoutes = [
  "/dashboard",
  "/admin",
  "/onboarding",
  "/invitation",
  "/connexion",
  "/mot-de-passe-oublie",
  "/reinitialiser-mot-de-passe",
] as const;

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          ...privateRoutes.flatMap((route) => [route, ...locales.map((locale) => `/${locale}${route}`)]),
          "/api",
          "/v1",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    host: siteConfig.appUrl,
  };
}
