import { PageShell } from "@/components/page-shell";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export default async function DeliverabilityPage() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { eyebrow: "Délivrabilité", title: "La réputation se protège avant le premier envoi.", intro: "Chaque workspace, domaine et cas d’usage est contrôlé avant activation, puis surveillé sur des fenêtres de 24 heures et sept jours.", cards: [["Authentification", "DKIM, Return-Path et DMARC vérifiés avant activation du domaine."], ["Suppression", "Hard bounces et plaintes sont supprimés localement pour le workspace concerné."], ["Prévention", "Première plainte : pause. Trois hard bounces : pause. Taux ≥ 2 % après 50 envois : pause."]], noTracking: "PAS DE TRACKING COMPORTEMENTAL", trackingText: "Mail by Yodev suit uniquement les états nécessaires à l’exploitation : acceptation, livraison, bounce, plainte et échec. Aucun pixel d’ouverture et aucune réécriture de lien." },
    en: { eyebrow: "Deliverability", title: "Reputation is protected before the first send.", intro: "Every workspace, domain, and use case is reviewed before activation, then monitored over 24-hour and seven-day windows.", cards: [["Authentication", "DKIM, Return-Path, and DMARC are verified before a domain is activated."], ["Suppression", "Hard bounces and complaints are suppressed locally for the affected workspace."], ["Prevention", "First complaint: pause. Three hard bounces: pause. Rate ≥ 2% after 50 sends: pause."]], noTracking: "NO BEHAVIORAL TRACKING", trackingText: "Mail by Yodev only follows operational states: acceptance, delivery, bounce, complaint, and failure. There are no open pixels and no link rewriting." },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="grid gap-6 md:grid-cols-3">{copy.cards.map(([title,text])=><article className="rounded-3xl border bg-white p-7" key={title}><h2 className="text-xl font-semibold">{title}</h2><p className="mt-3 leading-7 text-muted-foreground">{text}</p></article>)}</div><div className="mt-10 rounded-3xl border bg-[#0C1117] p-8 text-white"><p className="text-sm text-blue-300">{copy.noTracking}</p><p className="mt-4 max-w-3xl text-lg leading-8 text-white/70">{copy.trackingText}</p></div></PageShell>;
}
