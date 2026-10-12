import { Skeleton } from "@/components/ui/skeleton";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

/** Console page skeleton while a page's data streams in; the layout stays interactive. */
export default async function DashboardLoading() {
  const locale = await getLocale();
  return <div aria-busy="true" className="grid gap-6">
    <p className="sr-only" role="status">{localized(locale, { fr: "Chargement de la page…", en: "Loading the page…" })}</p>
    <div aria-hidden="true" className="grid gap-3">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
    <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => <Skeleton className="h-28" key={index} />)}
    </div>
    <div aria-hidden="true" className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  </div>;
}
