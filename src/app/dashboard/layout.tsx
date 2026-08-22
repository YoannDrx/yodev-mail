import { eq } from "drizzle-orm";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { requireDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { requirePageWorkspace } from "@/lib/page-auth";
import { localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const context = await requirePageWorkspace();
  if (context.workspace.status === "sandbox") redirect(localizedPath(locale, "/onboarding"));
  const [subscription] = await requireDb()
    .select({ pilotAccessExpiresAt: subscriptions.pilotAccessExpiresAt })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, context.workspace.id))
    .limit(1);
  const plan = subscription?.pilotAccessExpiresAt && subscription.pilotAccessExpiresAt > new Date()
    ? "pilote"
    : context.workspace.plan;
  return <div className="flex min-h-screen bg-[#f8f7fb]">
    <DashboardSidebar locale={locale} plan={plan} workspaceName={context.workspace.name} />
    <div className="min-w-0 flex-1">
      <DashboardHeader locale={locale} />
      <main className="mx-auto max-w-7xl p-5 sm:p-8">{children}</main>
    </div>
  </div>;
}
