import type { Metadata } from "next";
import { requireAdmin } from "@/lib/page-auth";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  // The page renders its own <main>; this wrapper is the skip-link target.
  return <div id="main-content" tabIndex={-1} className="outline-none">{children}</div>;
}
