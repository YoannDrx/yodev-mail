import { NextResponse, type NextRequest } from "next/server";
import {
  isMachinePath,
  localeCookieName,
  localeFromPathname,
  localizedPath,
  negotiateLocale,
  stripLocale,
} from "@/i18n/config";
import { contentSecurityPolicy, createNonce } from "@/lib/content-security-policy";
import { canonicalUrlForHost } from "@/lib/host-routing";

const cspHeader = "content-security-policy";

export default function proxy(request: NextRequest) {
  const canonical = canonicalUrlForHost(request.headers.get("host"), request.nextUrl);
  if (canonical) return NextResponse.redirect(canonical, 308);

  // A fresh nonce per request: Next.js reads it from the request CSP header
  // and the root layout forwards x-nonce to next-themes.
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce, { development: process.env.NODE_ENV === "development" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(cspHeader, policy);

  const { pathname } = request.nextUrl;
  if (isMachinePath(pathname)) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set(cspHeader, policy);
    return response;
  }

  const locale = localeFromPathname(pathname);
  if (!locale) {
    const preferredLocale = negotiateLocale(
      request.headers.get("accept-language"),
      request.cookies.get(localeCookieName)?.value,
    );
    const destination = request.nextUrl.clone();
    destination.pathname = localizedPath(preferredLocale, pathname);
    const response = NextResponse.redirect(destination, 307);
    response.cookies.set(localeCookieName, preferredLocale, {
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
    return response;
  }

  requestHeaders.set("x-yodev-locale", locale);
  requestHeaders.set("x-yodev-pathname", pathname);
  const destination = request.nextUrl.clone();
  destination.pathname = stripLocale(pathname);
  const response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
  response.headers.set("content-language", locale);
  response.headers.set(cspHeader, policy);
  response.cookies.set(localeCookieName, locale, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
  });
  return response;
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
