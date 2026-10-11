"use client";

import { useSyncExternalStore } from "react";
import { defaultLocale, isLocale, localeFromPathname, type Locale } from "@/i18n/config";

const subscribe = () => () => {};

function documentLocale(): Locale {
  const lang = document.documentElement.lang;
  if (isLocale(lang)) return lang;
  return localeFromPathname(window.location.pathname) ?? defaultLocale;
}

/**
 * Locale for client-only boundaries (error files) that cannot read request
 * headers: the root layout's <html lang>, then the URL prefix.
 */
export function useDocumentLocale(): Locale {
  return useSyncExternalStore(subscribe, documentLocale, () => defaultLocale);
}
