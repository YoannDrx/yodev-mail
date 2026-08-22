import "server-only";

import { headers } from "next/headers";
import { defaultLocale, isLocale, type Locale } from "@/i18n/config";

export async function getLocale(): Promise<Locale> {
  const locale = (await headers()).get("x-yodev-locale");
  return isLocale(locale) ? locale : defaultLocale;
}

export async function getOriginalPathname() {
  return (await headers()).get("x-yodev-pathname") ?? `/${await getLocale()}`;
}
