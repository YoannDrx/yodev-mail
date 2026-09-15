import { NavigationDisclosure } from "@/brand/navigation-disclosure";
import { Suspense } from "react";
import { LanguageSwitcher } from "./language-switcher";
import { Menu } from "lucide-react";
import { AccountMenu } from "@/components/auth/account-menu";
import { AppearanceToggle } from "@/components/appearance";
import { DashboardNavigation } from "./dashboard-navigation";
import { BrandMark } from "./brand-mark";
import type { Locale } from "@/i18n/config";
export function DashboardHeader({ locale }: { locale: Locale }) {
  return <header className="flex min-h-20 flex-wrap items-center gap-3 border-b bg-background px-5 py-3">
    <span className="mr-auto hidden text-sm text-muted-foreground lg:block">{locale === "fr" ? "Livraison transactionnelle" : "Transactional delivery"}</span>
    <span className="mr-auto lg:hidden"><BrandMark /></span>
    <div className="flex items-center gap-2">
      <AppearanceToggle locale={locale}/>
      <NavigationDisclosure className="y-mobile-menu lg:hidden" label={locale === "fr" ? "Navigation complète" : "Full navigation"} icon={<Menu size={20}/>}><DashboardNavigation locale={locale}/></NavigationDisclosure>
    </div>
    <div className="flex w-full flex-wrap items-center justify-between gap-2 lg:w-auto">
      <Suspense fallback={null}><LanguageSwitcher locale={locale} pathname="/" /></Suspense>
      <AccountMenu locale={locale}/>
    </div>
  </header>;
}
