import { NextResponse, type NextRequest } from "next/server";
import { canonicalUrlForHost } from "@/lib/host-routing";

export default function proxy(request: NextRequest) {
  const canonical = canonicalUrlForHost(request.headers.get("host"), request.nextUrl);
  if (canonical) return NextResponse.redirect(canonical, 308);
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
