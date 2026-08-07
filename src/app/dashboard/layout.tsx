import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { requirePageWorkspace } from "@/lib/page-auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({children}:{children:React.ReactNode}){const context=await requirePageWorkspace();return <div className="flex min-h-screen bg-[#f8f7fb]"><DashboardSidebar plan={context?.workspace.plan ?? "sandbox"} workspaceName={context?.workspace.name ?? "Workspace de démonstration"}/><div className="min-w-0 flex-1"><DashboardHeader/><main className="mx-auto max-w-7xl p-5 sm:p-8">{children}</main></div></div>}
