"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localizedPath, stripLocale, type Locale } from "@/i18n/config";
const groups = [
 { fr: "Suivi", en: "Activity", links: [["Vue d’ensemble","Overview","/dashboard"],["Emails","Emails","/dashboard/emails"],["Délivrabilité","Deliverability","/dashboard/delivrabilite"]] },
 { fr: "Configuration", en: "Configuration", links: [["Domaines","Domains","/dashboard/domaines"],["Cas d’usage","Use cases","/dashboard/profils"],["Templates","Templates","/dashboard/templates"],["Clés API","API keys","/dashboard/api-keys"],["Webhooks","Webhooks","/dashboard/webhooks"]] },
 { fr: "Espace de travail", en: "Workspace", links: [["Membres","Members","/dashboard/membres"],["Facturation","Billing","/dashboard/facturation"],["Paramètres","Settings","/dashboard/parametres"],["Documentation","Documentation","/docs"],["Administration","Administration","/admin"]] },
];
export function DashboardNavigation({ locale }: { locale: Locale }) {
 const pathname = stripLocale(usePathname());
 return <nav aria-label={locale === "fr" ? "Navigation principale" : "Main navigation"}>{groups.map(group => <div key={group.en}><p className="y-nav-group">{group[locale]}</p>{group.links.map(([fr,en,path]) => <Link key={path} className="y-app-link" href={localizedPath(locale,path)} aria-current={pathname === path || (path !== "/dashboard" && pathname.startsWith(path + "/")) ? "page" : undefined}>{locale === "fr" ? fr : en}</Link>)}</div>)}</nav>;
}
