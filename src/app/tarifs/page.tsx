import Link from "next/link";
import type { Metadata } from "next";
import { Check } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getLocale()) === "fr" ? "Tarifs" : "Pricing" };
}

export default async function PricingPage() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { eyebrow: "Tarif bêta", title: "Un abonnement d’exploitation, puis l’usage réellement accepté.", intro: "Pas de checkout public : l’abonnement est créé seulement après validation du dossier.", badge: "Bêta privée", platform: "Accès plateforme", price: "29 €", month: "mois", usage: "+ 0,0025 € par email accepté", example: "Soit 2,50 € pour 1 000 emails.", features: ["2 domaines", "3 membres", "Pièces jointes incluses en V1", "Accompagnement DNS", "Aucun email simulé ou refusé avant acceptation facturé"], apply: "Candidater", tax: "TVA appliquée selon le régime fiscal en vigueur au moment de la facturation. Aucun checkout n’est ouvert avant sa vérification." },
    en: { eyebrow: "Beta pricing", title: "An operations subscription, then the usage actually accepted.", intro: "There is no public checkout: the subscription is created only after the application is approved.", badge: "Private beta", platform: "Platform access", price: "€29", month: "month", usage: "+ €0.0025 per accepted email", example: "That is €2.50 per 1,000 emails.", features: ["2 domains", "3 members", "Attachments included in V1", "DNS assistance", "No simulated email or request rejected before acceptance is billed"], apply: "Apply", tax: "VAT is applied according to the tax regime in force at the time of invoicing. Checkout remains closed until this has been verified." },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="mx-auto max-w-xl"><article className="relative rounded-3xl border border-primary bg-white p-8 shadow-xl shadow-primary/10"><Badge className="absolute right-6 top-6">{copy.badge}</Badge><h2 className="text-2xl font-semibold">{copy.platform}</h2><p className="mt-4 text-4xl font-semibold">{copy.price}<span className="text-sm font-normal text-muted-foreground"> /{copy.month}</span></p><p className="mt-3 text-lg font-medium">{copy.usage}</p><p className="mt-1 text-sm text-muted-foreground">{copy.example}</p><ul className="mt-7 grid gap-3 text-sm">{copy.features.map((item)=><li className="flex gap-2" key={item}><Check className="size-4 text-emerald-600"/>{item}</li>)}</ul><Button asChild className="mt-7 w-full"><Link href={localizedPath(locale, "/inscription")}>{copy.apply}</Link></Button></article></div><p className="mt-8 text-center text-sm text-muted-foreground">{copy.tax}</p></PageShell>;
}
