export const locales = ["fr", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "fr";
export const localeCookieName = "yodev_mail_locale";

export function localized<T>(locale: Locale, values: Record<Locale, T>) {
  return values[locale];
}

const machineRoots = [
  "/api",
  "/v1",
  "/health",
  "/openapi.json",
  "/robots.txt",
  "/sitemap.xml",
  "/icon",
  "/favicon.ico",
] as const;

export function isLocale(value: string | undefined | null): value is Locale {
  return locales.includes(value as Locale);
}

export function isMachinePath(pathname: string) {
  return machineRoots.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}

export function localeFromPathname(pathname: string): Locale | null {
  const segment = pathname.split("/")[1];
  return isLocale(segment) ? segment : null;
}

export function stripLocale(pathname: string) {
  const locale = localeFromPathname(pathname);
  if (!locale) return pathname;
  const stripped = pathname.slice(locale.length + 1);
  return stripped || "/";
}

export function localizedPath(locale: Locale, pathname: string) {
  if (!pathname.startsWith("/")) return pathname;
  if (isMachinePath(pathname)) return pathname;
  const stripped = stripLocale(pathname);
  return stripped === "/" ? `/${locale}` : `/${locale}${stripped}`;
}

export function negotiateLocale(
  acceptLanguage: string | null,
  cookieLocale?: string | null,
): Locale {
  if (isLocale(cookieLocale)) return cookieLocale;
  if (!acceptLanguage) return defaultLocale;

  const candidates = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().toLowerCase().split(";");
      const qParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const quality = qParameter ? Number(qParameter.trim().slice(2)) : 1;
      return { index, language: tag.split("-")[0], quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter((candidate) => isLocale(candidate.language) && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  return (candidates[0]?.language as Locale | undefined) ?? defaultLocale;
}
