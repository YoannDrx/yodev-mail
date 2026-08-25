import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { enLegalPages } from "@/i18n/legal-en";
import { getLocale } from "@/i18n/server";

export type LegalPage={title:string;intro:string;sections:Array<[string,string]>};
const frPages:Record<string,LegalPage>={
  "anti-abus":{
    title:"Politique anti-abus",
    intro:"Mail by Yodev est exclusivement réservé aux messages transactionnels attendus par leur destinataire.",
    sections:[
      ["Usages autorisés","Un message doit être déclenché par une action utilisateur ou un événement métier documenté, envoyé à un destinataire unique et rattaché à un profil transactionnel approuvé."],
      ["Usages interdits","Sont interdits : campagnes, newsletters, publicité, prospection à froid, scraping, listes achetées, louées ou échangées, phishing, usurpation, contenu illicite et contournement d’une suspension."],
      ["Contrôles","Yodev examine l’identité, l’application, le domaine, le cas d’usage et les templates. Les quotas démarrent à 50 emails par jour et n’augmentent qu’après observation de métriques propres."],
      ["Suspension","Toute plainte provoque une pause et une revue manuelle. Une pause intervient aussi à trois hard bounces, ou à un taux de hard bounce d’au moins 2 % après 50 envois."],
      ["Signalement","Un abus peut être signalé à abuse@yodev.fr avec les en-têtes utiles. Ne transmettez pas de mot de passe ni de contenu sensible inutile."],
    ],
  },
  confidentialite:{
    title:"Politique de confidentialité",
    intro:"Finalités, durées de conservation et droits relatifs à Mail by Yodev.",
    sections:[
      ["Responsable et sous-traitant","Yodev, édité par Yoann Andrieux, entrepreneur individuel, est responsable des données de compte et d’administration. Pour le contenu et les destinataires transmis par un client, Yodev agit comme sous-traitant sur instructions documentées de ce client."],
      ["Données traitées","Le service traite les données de compte, paramètres de domaine, identifiants opaques, adresses nécessaires à la livraison, templates, contenu transactionnel, pièces jointes temporaires et événements techniques expurgés."],
      ["Finalités","Les données servent à authentifier les utilisateurs, vérifier les domaines, livrer les messages, traiter les incidents de délivrabilité, prévenir les abus, facturer l’usage et satisfaire les obligations légales."],
      ["Conservation","Les corps sont conservés 30 jours maximum et les pièces jointes 24 heures maximum. Après 90 jours, les adresses et noms liés aux messages sont remplacés, les adresses de suppression en clair sont retirées et les événements techniques sont supprimés. Les données contractuelles, de facturation et d’audit sont conservées pendant les durées nécessaires aux obligations applicables."],
      ["Transferts","Certains sous-traitants peuvent traiter des données hors de l’Espace économique européen. Yodev s’appuie alors sur les mécanismes de transfert déclarés par ces prestataires, notamment les clauses contractuelles types lorsqu’elles sont applicables."],
      ["Droits et contact","Les demandes d’accès, rectification, effacement, limitation ou opposition peuvent être adressées à support@yodev.fr. Une réclamation peut être déposée auprès de la CNIL."],
    ],
  },
  cgu:{
    title:"Conditions générales d’utilisation",
    intro:"Cadre d’utilisation de la bêta privée Mail by Yodev.",
    sections:[
      ["Accès","L’accès est nominatif, sur invitation et après validation du dossier. Le client protège ses clés Yodev et les révoque sans délai en cas de doute."],
      ["Service","Mail by Yodev fournit une API transactionnelle. Le fournisseur de transport est choisi par Yodev et peut évoluer sans modifier le contrat API, sous réserve de la liste des sous-traitants."],
      ["Obligations du client","Le client garantit la licéité du traitement, l’exactitude de son dossier, la relation légitime avec chaque destinataire et le caractère strictement transactionnel des contenus."],
      ["Prix","La bêta est facturée 29 € par mois, plus 0,0025 € par email accepté par le service de livraison. La TVA est appliquée selon le régime fiscal en vigueur au moment de la facturation. Les simulations et rejets antérieurs à l’acceptation ne sont pas facturés."],
      ["Suspension et résiliation","Yodev peut suspendre immédiatement un workspace, domaine, profil, template ou accès en cas de risque, de plainte, d’impayé, d’information inexacte ou de violation de la politique anti-abus."],
      ["Limites techniques","L’idempotence empêche la répétition d’une même requête côté Yodev. Un résultat fournisseur ambigu n’est jamais renvoyé automatiquement ; aucune garantie d’exécution exactement une fois n’est formulée."],
    ],
  },
  "mentions-legales":{
    title:"Mentions légales",
    intro:"Informations relatives à l’éditeur de Mail by Yodev.",
    sections:[
      ["Éditeur","Mail by Yodev est édité sous le nom commercial Yodev par Yoann Andrieux, entrepreneur individuel (EI)."],
      ["Immatriculation et activité","Yoann Andrieux EI est immatriculé au Registre national des entreprises (RNE) et au Registre du commerce et des sociétés (RCS) de Paris sous le numéro SIREN 803 272 590. SIRET : 803 272 590 00024. Activité principale : programmation informatique (NAF/APE 62.01Z)."],
      ["Régime de TVA","TVA non applicable, article 293 B du Code général des impôts."],
      ["Adresse professionnelle","7 allée des Jonquilles, 95130 Franconville, France."],
      ["Directeur de la publication","Yoann Andrieux."],
      ["Contact","support@yodev.fr."],
      ["Hébergement","L’application est hébergée par Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis. La base applicative est fournie par Neon. Les autres sous-traitants sont listés sur la page dédiée."],
    ],
  },
  dpa:{
    title:"Accord de sous-traitance (DPA)",
    intro:"Conditions de traitement des données personnelles confiées à Mail by Yodev.",
    sections:[
      ["Objet et durée","Yodev traite, pendant la durée du service et les périodes de rétention définies, les données nécessaires à la livraison des messages transactionnels pour le compte du client responsable de traitement."],
      ["Instructions","Yodev n’agit que sur les instructions documentées résultant du contrat, du paramétrage du workspace et des requêtes API licites, sauf obligation légale contraire notifiée lorsque la loi le permet."],
      ["Confidentialité et sécurité","Les accès sont limités, les secrets sont chiffrés, les pièces jointes sont temporaires et scannées, les files reçoivent uniquement des identifiants opaques, et les opérations administratives sensibles sont auditées."],
      ["Sous-traitants ultérieurs","Le client autorise les prestataires publiés dans la liste des sous-traitants. Un changement matériel est notifié dans un délai raisonnable afin de permettre une objection motivée."],
      ["Assistance","Yodev assiste raisonnablement le client pour les droits des personnes, la sécurité, les violations de données, les analyses d’impact et les demandes d’autorités, compte tenu de la nature du traitement."],
      ["Fin du service et audit","À la fin du service, les données sont supprimées selon les délais publiés, sauf obligation de conservation. Yodev fournit les informations raisonnablement nécessaires à la démonstration de conformité, sous réserve de confidentialité et de proportionnalité."],
    ],
  },
  "sous-traitants":{
    title:"Liste des sous-traitants",
    intro:"Prestataires susceptibles de traiter des données pour fournir Mail by Yodev.",
    sections:[
      ["Vercel","Hébergement de l’application web et des fonctions HTTP. Société américaine ; localisation et mécanismes de transfert selon le contrat Vercel applicable."],
      ["Neon","Base de données PostgreSQL managée, configurée dans une région européenne pour ce service."],
      ["Google","Fournisseur de connexion OAuth facultatif pour les membres invités. Les autres données d’authentification et d’organisation sont stockées par Yodev avec Better Auth."],
      ["Stripe","Abonnement, facturation, paiement et portail client. Les données de paiement sont traitées directement par Stripe."],
      ["Amazon Web Services","Files, fonctions, stockage temporaire, chiffrement, antivirus et, lorsqu’il est activé, transport transactionnel dans la région AWS configurée."],
      ["Postmark / ActiveCampaign","Transport transactionnel initial, authentification de domaine, événements de livraison, bounce et plainte. Le contenu est réglé sur une rétention maximale de 28 jours lorsque l’option contractuelle est active."],
    ],
  },
  sla:{
    title:"SLA bêta et incidents",
    intro:"Niveaux de service applicables pendant la bêta privée.",
    sections:[
      ["Périmètre bêta","La bêta est un service accompagné sans engagement de disponibilité financièrement garanti. Yodev vise une disponibilité mensuelle de 99,5 %, hors maintenance annoncée et dépendances externes."],
      ["Priorités","Un incident critique empêche toute acceptation ou crée un risque de sécurité ; un incident majeur dégrade une fonction essentielle ; un incident mineur dispose d’un contournement acceptable."],
      ["Communication","Les incidents critiques sont pris en charge en priorité et communiqués aux clients affectés par le canal disponible. Les demandes de support sont adressées à support@yodev.fr."],
      ["Sécurité","Une suspicion de violation, de clé compromise ou d’abus doit être signalée immédiatement. Yodev peut suspendre les envois pendant l’enquête et notifier les parties selon les obligations applicables."],
      ["Maintenance","Les maintenances planifiées sont annoncées lorsque possible. Les changements de domaine sont drainés avant bascule et ne provoquent jamais de failover automatique d’un message déjà transmis."],
    ],
  },
};

export function generateStaticParams(){return Object.keys(frPages).map((legal)=>({legal}))}
export default async function Page({params}:{params:Promise<{legal:string}>}){const [{legal},locale]=await Promise.all([params,getLocale()]);const page=(locale === "fr" ? frPages : enLegalPages)[legal];if(!page)notFound();return <PageShell eyebrow={locale === "fr" ? "Informations légales" : "Legal information"} title={page.title} intro={page.intro}><div className="mx-auto grid max-w-3xl gap-8">{page.sections.map(([title,text])=><section key={title}><h2 className="text-xl font-semibold">{title}</h2><p className="mt-3 leading-7 text-muted-foreground">{text}</p></section>)}<p className="text-sm text-muted-foreground">{locale === "fr" ? "Dernière mise à jour : 25 août 2026." : "Last updated: August 25, 2026."}</p></div></PageShell>}
