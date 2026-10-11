import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: localized(await getLocale(), { fr: "Ressource introuvable", en: "Resource not found" }) };
}

/** Rendered inside the console layout, so navigation stays available. */
export default async function DashboardNotFound() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { title: "Ressource introuvable", text: "Cet élément n’existe pas ou n’appartient pas au workspace actif. Si vous avez plusieurs workspaces, vérifiez celui qui est sélectionné.", back: "Retour à la vue d’ensemble", emails: "Voir les emails" },
    en: { title: "Resource not found", text: "This item does not exist or does not belong to the active workspace. If you have several workspaces, check which one is selected.", back: "Back to overview", emails: "View emails" },
  });
  return <section className="mx-auto grid max-w-2xl gap-5 py-12">
    {/* notFound() thrown by a page keeps that page's metadata: React hoists this title instead. */}
    <title>{`${copy.title} — Yodev Mail`}</title>
    <p className="font-mono text-sm text-muted-foreground">404</p>
    <h1 className="text-3xl font-semibold tracking-tight">{copy.title}</h1>
    <p className="text-muted-foreground">{copy.text}</p>
    <div className="flex flex-wrap gap-3">
      <Button asChild className="h-10"><Link href={localizedPath(locale, "/dashboard")}>{copy.back}</Link></Button>
      <Button asChild className="h-10" variant="outline"><Link href={localizedPath(locale, "/dashboard/emails")}>{copy.emails}</Link></Button>
    </div>
  </section>;
}
