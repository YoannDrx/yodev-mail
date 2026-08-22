import { NextResponse, type NextRequest } from "next/server";
import {
  isMachinePath,
  localeCookieName,
  localeFromPathname,
  localizedPath,
  negotiateLocale,
  stripLocale,
} from "@/i18n/config";
import { canonicalUrlForHost } from "@/lib/host-routing";

export default function proxy(request: NextRequest) {
  const canonical = canonicalUrlForHost(request.headers.get("host"), request.nextUrl);
  if (canonical) return NextResponse.redirect(canonical, 308);

  const { pathname } = request.nextUrl;
  if (isMachinePath(pathname)) return NextResponse.next();

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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-yodev-locale", locale);
  requestHeaders.set("x-yodev-pathname", pathname);
  const destination = request.nextUrl.clone();
  destination.pathname = stripLocale(pathname);
  const response = NextResponse.rewrite(destination, { request: { headers: requestHeaders } });
  response.headers.set("content-language", locale);
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
