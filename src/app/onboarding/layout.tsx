import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser();
  // The page renders its own <main>; this wrapper is the skip-link target.
  return <div id="main-content" tabIndex={-1} className="outline-none">{children}</div>;
}
