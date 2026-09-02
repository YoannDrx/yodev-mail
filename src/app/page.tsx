import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Braces, Check, FileCheck2, LockKeyhole, Radar, ShieldCheck, Sparkles } from "lucide-react";
import { MarketingFooter } from "@/components/marketing-footer";
import { MarketingHeader } from "@/components/marketing-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { localized, localizedPath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

const icons = [Braces, FileCheck2, Radar, ShieldCheck] as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    alternates: {
      canonical: `https://mail.yodev.fr/${locale}`,
      languages: { en: "https://mail.yodev.fr/en", fr: "https://mail.yodev.fr/fr" },
    },
  };
}

export default async function Home() {
  const locale = await getLocale();
  const href = (pathname: string) => localizedPath(locale, pathname);
  const copy = localized(locale, {
    fr: {
      badge: "Bêta privée · Sur dossier", hero: "Vos emails transactionnels.", heroAccent: "L’infrastructure en moins.",
      intro: "Mail by Yodev vérifie les domaines de vos applications, opère la livraison et vous expose une API unique. Un appel correspond à un événement applicatif et à un destinataire.",
      apply: "Candidater à la bêta", explore: "Explorer l’API", flow: "Flux transactionnel", verified: "Domaine vérifié",
      metrics: [["Destinataires", "1 / requête"], ["Tracking", "Désactivé"], ["Template", "Approuvé"], ["Statut", "Délivré"]],
      managed: "UNE PASSERELLE GÉRÉE", managedTitle: "Vos clients gardent leur domaine. Yodev prend en charge le setup et l’exploitation.",
      benefits: [
        ["Une API, un événement, un destinataire", "Un contrat HTTP strict, une clé Yodev et une idempotence obligatoire. Aucun compte fournisseur à créer."],
        ["Cas d’usage et templates approuvés", "Chaque application, catégorie transactionnelle et modèle est relu avant le premier envoi live."],
        ["Délivrabilité opérée", "Yodev prépare le DNS, normalise les événements et surveille bounces, plaintes, suppressions et files."],
        ["Garde-fous automatiques", "Quotas progressifs, suspension immédiate à la première plainte et aucune relance après un résultat ambigu."],
      ],
      month: "mois", betaTitle: "Une bêta accompagnée, sans compte technique à déléguer.",
      betaText: "Deux domaines, trois membres, puis 2,50 € par 1 000 emails acceptés pour livraison. Aucun email simulé ou refusé avant acceptation n’est facturé.",
      included: ["Validation manuelle avant clé live", "Accompagnement DNS inclus", "Templates transactionnels relus"],
      seePricing: "Voir le tarif bêta", platform: "Accès plateforme", measured: "Usage mesuré", price: "29 €", usagePrice: "0,0025 €", perAccepted: "email accepté",
      ctaTitle: "Décrivez votre premier flux transactionnel.", ctaText: "Les premiers workspaces sont examinés et accompagnés à la main.",
    },
    en: {
      badge: "Private beta · Application required", hero: "Your transactional emails.", heroAccent: "Without the infrastructure burden.",
      intro: "Mail by Yodev verifies your applications’ domains, operates delivery, and gives you one consistent API. Each call maps to one application event and one recipient.",
      apply: "Apply for the beta", explore: "Explore the API", flow: "Transactional flow", verified: "Domain verified",
      metrics: [["Recipients", "1 / request"], ["Tracking", "Disabled"], ["Template", "Approved"], ["Status", "Delivered"]],
      managed: "A MANAGED GATEWAY", managedTitle: "Your customers keep their domain. Yodev handles setup and operations.",
      benefits: [
        ["One API, one event, one recipient", "A strict HTTP contract, a Yodev key, and mandatory idempotency. No provider account to create."],
        ["Approved use cases and templates", "Every application, transactional category, and template is reviewed before its first live send."],
        ["Managed deliverability", "Yodev prepares DNS, normalizes events, and monitors bounces, complaints, suppressions, and queues."],
        ["Automatic safeguards", "Progressive quotas, immediate suspension after the first complaint, and no retry after an ambiguous result."],
      ],
      month: "month", betaTitle: "A guided beta, with no technical provider account to delegate.",
      betaText: "Two domains, three members, then €2.50 per 1,000 emails accepted for delivery. Simulated emails and requests rejected before acceptance are never billed.",
      included: ["Manual approval before a live key", "DNS assistance included", "Reviewed transactional templates"],
      seePricing: "View beta pricing", platform: "Platform access", measured: "Metered usage", price: "€29", usagePrice: "€0.0025", perAccepted: "accepted email",
      ctaTitle: "Describe your first transactional flow.", ctaText: "The first workspaces are reviewed and guided manually.",
    },
  });

  return <><MarketingHeader/><main>
    <section className="relative overflow-hidden px-5 pb-24 pt-20 sm:pt-28"><div className="mx-auto max-w-6xl text-center"><Badge variant="secondary" className="mb-7 border border-primary/15 bg-primary/5 text-primary"><Sparkles className="mr-1 size-3"/> {copy.badge}</Badge><h1 className="mx-auto max-w-4xl text-balance text-5xl font-semibold tracking-[-.045em] sm:text-7xl">{copy.hero}<br/><span className="bg-gradient-to-r from-blue-700 to-cyan-500 bg-clip-text text-transparent">{copy.heroAccent}</span></h1><p className="mx-auto mt-7 max-w-2xl text-balance text-lg leading-8 text-muted-foreground sm:text-xl">{copy.intro}</p><div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"><Button asChild size="lg" className="h-12 px-6"><Link href={href("/inscription")}>{copy.apply} <ArrowRight/></Link></Button><Button asChild size="lg" variant="outline" className="h-12 bg-white"><Link href={href("/docs")}>{copy.explore}</Link></Button></div><div className="mx-auto mt-14 max-w-5xl rounded-[2rem] border bg-[#0C1117] p-3 text-left shadow-2xl shadow-blue-900/15"><div className="rounded-3xl border border-white/10 bg-white/[.04] p-6 text-white sm:p-8"><div className="flex items-center justify-between"><div><p className="text-sm text-white/55">{copy.flow}</p><p className="mt-1 text-xl font-medium">payment_receipt</p></div><span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">● {copy.verified}</span></div><div className="mt-8 grid gap-3 sm:grid-cols-4">{copy.metrics.map(([label,value])=><div key={label} className="rounded-2xl border border-white/8 bg-white/[.04] p-4"><p className="text-xs text-white/45">{label}</p><p className="mt-2 text-lg font-medium">{value}</p></div>)}</div></div></div></div></section>
    <section className="border-y bg-white/70 px-5 py-24"><div className="mx-auto max-w-6xl"><p className="text-sm font-medium text-primary">{copy.managed}</p><h2 className="mt-3 max-w-3xl text-4xl font-semibold tracking-tight">{copy.managedTitle}</h2><div className="mt-12 grid gap-5 md:grid-cols-2">{copy.benefits.map(([title,text], index)=>{const Icon=icons[index] ?? Braces;return <article key={title} className="rounded-3xl border bg-background p-7 shadow-sm"><span className="inline-flex rounded-xl bg-primary/10 p-3 text-primary"><Icon/></span><h3 className="mt-6 text-xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p></article>})}</div></div></section>
    <section className="px-5 py-24"><div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2"><div><Badge>{copy.price} / {copy.month}</Badge><h2 className="mt-5 text-4xl font-semibold tracking-tight">{copy.betaTitle}</h2><p className="mt-4 leading-7 text-muted-foreground">{copy.betaText}</p><ul className="mt-7 grid gap-3 text-sm">{copy.included.map((item)=><li key={item} className="flex gap-2"><Check className="size-5 text-emerald-600"/>{item}</li>)}</ul><Button asChild className="mt-8" variant="outline"><Link href={href("/tarifs")}>{copy.seePricing}</Link></Button></div><div className="rounded-3xl border bg-white p-8 shadow-xl"><LockKeyhole className="size-7 text-primary"/><p className="mt-5 text-sm text-muted-foreground">{copy.platform}</p><p className="mt-2 text-5xl font-semibold">{copy.price}<span className="text-base font-normal text-muted-foreground"> / {copy.month}</span></p><div className="my-7 h-px bg-border"/><p className="text-sm text-muted-foreground">{copy.measured}</p><p className="mt-2 text-2xl font-medium">{copy.usagePrice} / {copy.perAccepted}</p></div></div></section>
    <section className="px-5 pb-24"><div className="mx-auto max-w-6xl rounded-[2rem] bg-[#0C1117] px-7 py-16 text-center text-white"><h2 className="text-4xl font-semibold">{copy.ctaTitle}</h2><p className="mx-auto mt-4 max-w-xl text-white/60">{copy.ctaText}</p><Button asChild size="lg" className="mt-8 bg-white text-black hover:bg-white/90"><Link href={href("/inscription")}>{copy.apply} <ArrowRight/></Link></Button></div></section>
  </main><MarketingFooter/></>;
}
