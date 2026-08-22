import { PageShell } from "@/components/page-shell";
import { localized } from "@/i18n/config";
import { getLocale } from "@/i18n/server";

export default async function Page() {
  const locale = await getLocale();
  const copy = localized(locale, {
    fr: { eyebrow: "Conformité", title: "Strictement transactionnel, contrôlé avant activation.", intro: "Le produit exclut les campagnes, newsletters, listes importées, prospection à froid et messages promotionnels.", sections: [["Finalité limitée", "Chaque message doit être déclenché par un événement métier ou une action de l’utilisateur, envoyé à un destinataire unique et rattaché à un profil transactionnel approuvé."], ["Minimisation", "Le contenu est conservé au maximum 30 jours et les pièces jointes 24 heures. Après 90 jours, les champs d’adressage sont remplacés, les suppressions ne gardent que leur empreinte de recherche et les événements techniques sont supprimés. Les files et journaux opérationnels ne doivent contenir ni adresse, ni sujet, ni corps."], ["Droits et sous-traitance", "Le client reste responsable de son traitement métier ; Yodev agit comme sous-traitant pour la livraison. Un DPA et la liste des sous-traitants sont publiés dans l’espace légal."]] },
    en: { eyebrow: "Compliance", title: "Strictly transactional and reviewed before activation.", intro: "The product excludes campaigns, newsletters, imported lists, cold outreach, and promotional messages.", sections: [["Limited purpose", "Every message must be triggered by a business event or user action, sent to one recipient, and attached to an approved transactional profile."], ["Data minimization", "Content is retained for no more than 30 days and attachments for 24 hours. After 90 days, addressing fields are replaced, suppressions keep only a searchable fingerprint, and technical events are deleted. Operational queues and logs must never contain addresses, subjects, or bodies."], ["Rights and subprocessors", "The customer remains responsible for its business processing; Yodev acts as a processor for delivery. A DPA and the subprocessor list are published in the legal area."]] },
  });
  return <PageShell eyebrow={copy.eyebrow} title={copy.title} intro={copy.intro}><div className="prose prose-zinc mx-auto max-w-3xl">{copy.sections.map(([title,text])=><section key={title}><h2>{title}</h2><p>{text}</p></section>)}</div></PageShell>;
}
