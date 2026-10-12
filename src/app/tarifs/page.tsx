import Link from "next/link";
import type { Metadata } from "next";
import { Check, Clock } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { getFeatureAvailability } from "@/lib/feature-availability";
import { betaPlanDisplay } from "@/lib/plan-display";
import { publicPageMetadata } from "@/lib/public-metadata";
import { vatStatement } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const plan = betaPlanDisplay(locale);
  return publicPageMetadata(locale, "/tarifs", {
    title: localized(locale, { fr: "Tarifs", en: "Pricing" }),
    description: localized(locale, {
      fr: `Bêta privée Mail by Yodev : ${plan.monthly} par mois, puis ${plan.perEmail} par email accepté pour livraison. Aucun email simulé ni refusé n’est facturé.`,
      en: `Mail by Yodev private beta: ${plan.monthly} per month, then ${plan.perEmail} per email accepted for delivery. Simulated or rejected emails are never billed.`,
    }),
  });
}

export default async function PricingPage() {
  const locale = await getLocale();
  const plan = betaPlanDisplay(locale);
  const features = getFeatureAvailability();
  const gated = localized(locale, {
    fr: { liveSending: "Envois live avec une clé ym_live_", customerWebhooks: "Webhooks clients signés", attachments: "Pièces jointes analysées" },
    en: { liveSending: "Live sending with a ym_live_ key", customerWebhooks: "Signed customer webhooks", attachments: "Scanned attachments" },
  });
  const gatedKeys = ["liveSending", "customerWebhooks", "attachments"] as const;
  const available = gatedKeys.filter((key) => features[key]).map((key) => gated[key]);
  const upcoming = gatedKeys.filter((key) => !features[key]).map((key) => gated[key]);
  const copy = localized(locale, {
    fr: { eyebrow: "Tarif bêta", title: "Un abonnement d’exploitation, puis l’usage réellement accepté.", intro: "Pas de paiement en libre-service : l’abonnement est créé seulement après validation du dossier.", badge: "Bêta privée", platform: "Accès plateforme", month: "mois", usage: `+ ${plan.perEmail} par email accepté`, example: `Soit ${plan.perThousand} pour 1 000 emails.`, features: [`${plan.domains} domaines`, `${plan.members} membres`, "Clés ym_test_ : validation complète, sans envoi ni facturation", "Accompagnement DNS", "Aucun pixel de suivi", ...available, "Aucun email simulé ou refusé avant acceptation facturé"], upcomingTitle: "Bientôt", upcomingText: "Ces fonctions ne sont pas encore ouvertes dans la bêta et ne sont pas facturées :", apply: "Candidater", checkout: "Le paiement en ligne n’est pas encore ouvert : l’abonnement est mis en place avec vous après validation du dossier." },
    en: { eyebrow: "Beta pricing", title: "An operations subscription, then the usage actually accepted.", intro: "There is no self-service payment: the subscription is created only after the application is approved.", badge: "Private beta", platform: "Platform access", month: "month", usage: `+ ${plan.perEmail} per accepted email`, example: `That is ${plan.perThousand} per 1,000 emails.`, features: [`${plan.domains} domains`, `${plan.members} members`, "ym_test_ keys: full validation, no delivery, no billing", "DNS assistance", "No tracking pixel", ...available, "No simulated email or request rejected before acceptance is billed"], upcomingTitle: "Coming soon", upcomingText: "These capabilities are not open in the beta yet and are not billed:", apply: "Apply", checkout: "Online payment is not open yet: the subscription is set up with you after your application is approved." },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="mx-auto max-w-xl"><article className="relative rounded-md border border-primary bg-card p-8  shadow-primary/10"><Badge className="absolute right-6 top-6">{copy.badge}</Badge><h2 className="text-2xl font-semibold">{copy.platform}</h2><p className="mt-4 text-4xl font-semibold">{plan.monthly}<span className="text-sm font-normal text-muted-foreground"> /{copy.month}</span></p><p className="mt-3 text-lg font-medium">{copy.usage}</p><p className="mt-1 text-sm text-muted-foreground">{copy.example}</p><ul className="mt-7 grid gap-3 text-sm">{copy.features.map((item)=><li className="flex gap-2" key={item}><Check aria-hidden="true" className="size-4 shrink-0 text-[var(--y-success)]"/>{item}</li>)}</ul>{upcoming.length > 0 && <div className="mt-7 border-t pt-6"><h3 className="text-sm font-semibold">{copy.upcomingTitle}</h3><p className="mt-1 text-sm text-muted-foreground">{copy.upcomingText}</p><ul className="mt-3 grid gap-2 text-sm text-muted-foreground">{upcoming.map((item)=><li className="flex gap-2" key={item}><Clock aria-hidden="true" className="size-4 shrink-0"/>{item}</li>)}</ul></div>}<Button asChild className="mt-7 w-full"><Link href={localizedPath(locale, "/inscription")}>{copy.apply}</Link></Button></article></div><div className="mt-8 grid gap-2 text-center text-sm text-muted-foreground"><p>{vatStatement[locale]}</p>{!features.liveCheckout && <p>{copy.checkout}</p>}</div></PageShell>;
}
