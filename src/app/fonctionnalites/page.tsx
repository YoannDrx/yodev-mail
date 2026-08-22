import { Activity, Braces, FileCheck2, MailCheck, Paperclip, ShieldCheck } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

const icons = [Braces, FileCheck2, MailCheck, Paperclip, Activity, ShieldCheck] as const;

export default async function FeaturesPage() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { eyebrow: "Produit", title: "La livraison transactionnelle, sans compte fournisseur à opérer.", intro: "Mail by Yodev prend en charge l’infrastructure et vous donne une interface unique, réservée aux événements applicatifs légitimes.", features: [["API transactionnelle stricte", "Un destinataire, une catégorie approuvée, une clé idempotente et des statuts normalisés."], ["Templates relus", "Les templates sont liés à un cas d’usage. Toute modification de contenu déclenche une nouvelle revue."], ["Domaines accompagnés", "Yodev prépare DKIM, Return-Path et DMARC, puis active le service de livraison après vérification réelle."], ["Pièces jointes sûres", "URL présignée, checksum, contrôle MIME, scan antivirus et suppression au plus tard après 24 heures."], ["Délivrabilité visible", "Livraisons, bounces, plaintes, suppressions, quotas et alertes dans un cockpit sans tracking comportemental."], ["Anti-abus natif", "Bêta sur dossier, quotas 50/200/500, suspension immédiate et audit de chaque décision."]] },
    en: { eyebrow: "Product", title: "Transactional delivery, without a provider account to operate.", intro: "Mail by Yodev operates the infrastructure and gives you one interface reserved for legitimate application events.", features: [["Strict transactional API", "One recipient, one approved category, an idempotency key, and normalized statuses."], ["Reviewed templates", "Templates belong to a use case. Any content change triggers a new review."], ["Guided domain setup", "Yodev prepares DKIM, Return-Path, and DMARC, then enables delivery after real verification."], ["Safe attachments", "Presigned URL, checksum, MIME validation, malware scanning, and deletion within 24 hours."], ["Visible deliverability", "Deliveries, bounces, complaints, suppressions, quotas, and alerts without behavioral tracking."], ["Built-in anti-abuse", "Application-only beta, 50/200/500 quotas, immediate suspension, and an audit trail for every decision."]] },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{copy.features.map(([title,text], index)=>{const Icon=icons[index] ?? Activity;return <article key={title} className="rounded-3xl border bg-white p-7"><Icon className="size-6 text-primary"/><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p></article>})}</div></PageShell>;
}
