import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Check, Code2, Gauge, Radar, ShieldCheck, Sparkles } from "lucide-react";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const benefits = [
  { icon: Gauge, title: "La puissance SES, enfin lisible", text: "Un coût de transport transparent, des quotas surveillés et une réputation visible." },
  { icon: Radar, title: "Un cockpit pour tous vos projets", text: "Domaines, campagnes, transactionnel et équipes réunis sans mélanger les réputations." },
  { icon: ShieldCheck, title: "Conçu pour la conformité", text: "Consentements, suppressions, one-click et preuves d'audit intégrés dès la première adresse." },
  { icon: Code2, title: "API simple, infrastructure solide", text: "Idempotence, webhooks signés et files durables sans avoir à opérer AWS vous-même." },
];

export const metadata: Metadata = {
  alternates: { canonical: "https://mail.yodev.fr" },
};

export default function Home() {
  return <><MarketingHeader/><main>
    <section className="relative overflow-hidden px-5 pb-24 pt-20 sm:pt-28"><div className="mx-auto max-w-6xl text-center">
      <Badge variant="secondary" className="mb-7 border border-primary/15 bg-primary/5 text-primary"><Sparkles className="mr-1 size-3"/> Bêta privée · Made in France</Badge>
      <h1 className="mx-auto max-w-4xl text-balance text-5xl font-semibold tracking-[-.045em] sm:text-7xl">Tous vos emails.<br/><span className="bg-gradient-to-r from-violet-600 to-rose-500 bg-clip-text text-transparent">Zéro angle mort.</span></h1>
      <p className="mx-auto mt-7 max-w-2xl text-balance text-lg leading-8 text-muted-foreground sm:text-xl">Envoyez vos campagnes et emails transactionnels avec Amazon SES, sans subir sa complexité. Mail by Yodev protège votre réputation, projet par projet.</p>
      <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"><Button asChild size="lg" className="h-12 px-6"><Link href="/inscription">Rejoindre la bêta <ArrowRight/></Link></Button><Button asChild size="lg" variant="outline" className="h-12 bg-white"><Link href="/docs">Explorer l'API</Link></Button></div>
      <div className="mx-auto mt-14 max-w-5xl rounded-[2rem] border bg-[#17151f] p-3 text-left shadow-2xl shadow-violet-900/15"><div className="rounded-3xl border border-white/10 bg-[#211e2c] p-6 text-white sm:p-8"><div className="flex items-center justify-between"><div><p className="text-sm text-white/55">Vue d'ensemble</p><p className="mt-1 text-xl font-medium">Bonjour Yoann, tout est sous contrôle.</p></div><span className="hidden rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300 sm:block">● Systèmes opérationnels</span></div><div className="mt-8 grid gap-3 sm:grid-cols-4">{[["Emails ce mois","48 294"],["Délivrés","99,42 %"],["Bounces","0,71 %"],["Plaintes","0,03 %"]].map(([a,b])=><div key={a} className="rounded-2xl border border-white/8 bg-white/[.04] p-4"><p className="text-xs text-white/45">{a}</p><p className="mt-2 text-2xl font-medium">{b}</p></div>)}</div></div></div>
    </div></section>
    <section className="border-y bg-white/70 px-5 py-24"><div className="mx-auto max-w-6xl"><p className="text-sm font-medium text-primary">UNE INFRASTRUCTURE QUI VEILLE</p><h2 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight">La sérénité d'un produit fini. La marge d'Amazon SES.</h2><div className="mt-12 grid gap-5 md:grid-cols-2">{benefits.map(({icon:Icon,title,text})=><article key={title} className="rounded-3xl border bg-background p-7 shadow-sm"><span className="inline-flex rounded-xl bg-primary/10 p-3 text-primary"><Icon/></span><h3 className="mt-6 text-xl font-semibold">{title}</h3><p className="mt-3 leading-7 text-muted-foreground">{text}</p></article>)}</div></div></section>
    <section className="px-5 py-24"><div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2"><div><Badge>À partir de 19 € HT / mois</Badge><h2 className="mt-5 text-4xl font-semibold tracking-tight">Une tarification qui grandit avec vos envois.</h2><p className="mt-4 leading-7 text-muted-foreground">20 000 emails inclus, deux domaines et trois membres. Aucun forfait opaque, aucun contact facturé au repos.</p><ul className="mt-7 grid gap-3 text-sm">{["Sandbox gratuite et sécurisée","Dépassements au millier réellement accepté","Portail de facturation et factures TVA"].map(x=><li key={x} className="flex gap-2"><Check className="size-5 text-emerald-600"/>{x}</li>)}</ul><Button asChild className="mt-8" variant="outline"><Link href="/tarifs">Voir tous les tarifs</Link></Button></div><div className="rounded-3xl border bg-white p-8 shadow-xl"><p className="text-sm text-muted-foreground">Starter</p><p className="mt-2 text-5xl font-semibold">19 €<span className="text-base font-normal text-muted-foreground"> / mois</span></p><div className="my-7 h-px bg-border"/><p className="text-sm text-muted-foreground">Coût effectif pour 20 000 emails</p><p className="mt-2 text-2xl font-medium">0,95 € / 1 000</p><p className="mt-2 text-xs text-muted-foreground">Prix HT, transport SES compris dans le quota.</p></div></div></section>
    <section className="px-5 pb-24"><div className="mx-auto max-w-6xl rounded-[2rem] bg-[#17151f] px-7 py-16 text-center text-white"><h2 className="text-4xl font-semibold">Votre réputation mérite une vigie.</h2><p className="mx-auto mt-4 max-w-xl text-white/60">Rejoignez les premiers workspaces accompagnés à la main pendant la bêta privée.</p><Button asChild size="lg" className="mt-8 bg-white text-black hover:bg-white/90"><Link href="/inscription">Candidater à la bêta <ArrowRight/></Link></Button></div></section>
  </main><MarketingFooter/></>;
}
