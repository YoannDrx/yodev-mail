import type { Metadata } from "next";
import { Activity, Braces, FileCheck2, MailCheck, Paperclip, ShieldCheck, Webhook } from "lucide-react";
import { PageShell } from "@/components/page-shell";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { getFeatureAvailability } from "@/lib/feature-availability";
import { publicPageMetadata } from "@/lib/public-metadata";

const icons = [Braces, FileCheck2, MailCheck, Activity, ShieldCheck, Webhook, Paperclip] as const;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return publicPageMetadata(locale, "/fonctionnalites", {
    title: localized(locale, { fr: "Fonctionnalités", en: "Features" }),
    description: localized(locale, {
      fr: "API transactionnelle stricte, templates relus, domaines accompagnés, délivrabilité visible sans pixel de suivi et anti-abus natif.",
      en: "A strict transactional API, reviewed templates, guided domain setup, visible deliverability without tracking pixels, and built-in anti-abuse.",
    }),
  });
}

export default async function FeaturesPage() {
  const locale = await getLocale();
  const { attachments, customerWebhooks } = getFeatureAvailability();
  const copy = localized(locale, {
    fr: {
      eyebrow: "Produit", title: "La livraison transactionnelle, sans compte fournisseur à opérer.", intro: "Mail by Yodev prend en charge l’infrastructure et vous donne une interface unique, réservée aux événements applicatifs légitimes.", soon: "Bientôt",
      features: [
        ["API transactionnelle stricte", "Un destinataire, une catégorie approuvée, une clé idempotente et des statuts normalisés."],
        ["Templates relus", "Les templates sont liés à un cas d’usage. Toute modification de contenu déclenche une nouvelle revue."],
        ["Domaines accompagnés", "Yodev prépare DKIM, Return-Path et DMARC, puis active le service de livraison après vérification réelle."],
        ["Délivrabilité visible", "Livraisons, bounces, plaintes, suppressions, quotas et alertes dans un cockpit. Aucun pixel de suivi, aucune réécriture de lien."],
        ["Anti-abus natif", "Bêta sur dossier, quotas 50/200/500, suspension immédiate et audit de chaque décision."],
        customerWebhooks
          ? ["Webhooks signés", "Les événements de livraison sont envoyés à votre URL, signés avec x-yodev-mail-signature et x-yodev-mail-timestamp."]
          : ["Webhooks signés", "La livraison d’événements signés vers votre URL est implémentée mais pas encore ouverte dans la bêta. Les statuts restent consultables par l’API et la console."],
        attachments
          ? ["Pièces jointes contrôlées", "Upload présigné, empreinte SHA-256, contrôle du type, analyse antivirus et suppression sous 24 heures."]
          : ["Pièces jointes", "Le chemin sécurisé est implémenté, mais reste fermé dans la bêta privée jusqu’à sa certification isolée. L’API refuse aujourd’hui les pièces jointes."],
      ],
    },
    en: {
      eyebrow: "Product", title: "Transactional delivery, without a provider account to operate.", intro: "Mail by Yodev operates the infrastructure and gives you one interface reserved for legitimate application events.", soon: "Coming soon",
      features: [
        ["Strict transactional API", "One recipient, one approved category, an idempotency key, and normalized statuses."],
        ["Reviewed templates", "Templates belong to a use case. Any content change triggers a new review."],
        ["Guided domain setup", "Yodev prepares DKIM, Return-Path, and DMARC, then enables delivery after real verification."],
        ["Visible deliverability", "Deliveries, bounces, complaints, suppressions, quotas, and alerts in one cockpit. No tracking pixel and no link rewriting."],
        ["Built-in anti-abuse", "Application-only beta, 50/200/500 quotas, immediate suspension, and an audit trail for every decision."],
        customerWebhooks
          ? ["Signed webhooks", "Delivery events are posted to your URL, signed with x-yodev-mail-signature and x-yodev-mail-timestamp."]
          : ["Signed webhooks", "Signed event delivery to your URL is implemented but not open in the beta yet. Statuses remain available through the API and the console."],
        attachments
          ? ["Controlled attachments", "Presigned upload, SHA-256 fingerprint, type checks, malware scanning, and deletion within 24 hours."]
          : ["Attachments", "The secure path is implemented but stays closed in the private beta until its isolated certification is complete. The API currently rejects attachments."],
      ],
    },
  });
  const upcoming = [false, false, false, false, false, !customerWebhooks, !attachments];
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">{copy.features.map(([title,text], index)=>{const Icon=icons[index] ?? Activity;return <article key={title} className="rounded-md border bg-card p-7"><div className="flex items-start justify-between gap-3"><Icon aria-hidden="true" className="size-6 text-primary"/>{upcoming[index] && <span className="rounded-md border px-2 py-0.5 text-xs font-medium text-muted-foreground">{copy.soon}</span>}</div><h2 className="mt-5 text-xl font-semibold">{title}</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p></article>})}</div></PageShell>;
}
