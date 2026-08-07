import type { MetadataRoute } from "next";

const publicPaths = ["", "/fonctionnalites", "/tarifs", "/delivrabilite", "/conformite", "/docs"];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.map((path, index) => ({
    url: `https://mail.yodev.fr${path}`,
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : 0.7,
  }));
}
