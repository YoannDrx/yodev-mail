import { BrandMark } from "@/components/brand-mark";
import { ProductLinks } from "@/brand/brand";
import { DashboardNavigation } from "./dashboard-navigation";
import type { Locale } from "@/i18n/config";
import { statusLabel } from "@/i18n/format";
export function DashboardSidebar({locale,plan,workspaceName}:{locale:Locale;plan:string;workspaceName:string}) {
 return <aside className="hidden w-64 shrink-0 border-r bg-card lg:flex lg:flex-col"><div className="flex h-20 items-center border-b px-5"><BrandMark className="text-xl"/></div><div className="border-b p-5"><p className="text-xs text-muted-foreground">{locale === "fr" ? "Espace de travail" : "Workspace"}</p><p className="mt-2 break-words text-sm">{workspaceName}</p><p className="mt-2 text-xs text-muted-foreground">{plan === "pilote" ? locale === "fr" ? "Pilote" : "Pilot" : statusLabel(locale,plan)}</p></div><DashboardNavigation locale={locale}/><div className="mt-auto border-t p-5"><ProductLinks current="mail" locale={locale}/></div></aside>;
}
