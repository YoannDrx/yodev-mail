import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isClerkConfigured } from "@/lib/env";
const withClerk = clerkMiddleware();
export default function proxy(request: NextRequest, event: NextFetchEvent){return isClerkConfigured()?withClerk(request,event):NextResponse.next()}
export const config={matcher:["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)","/(api|trpc)(.*)"]};
