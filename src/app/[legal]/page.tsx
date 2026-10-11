import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { enLegalPages } from "@/i18n/legal-en";
import { getLocale } from "@/i18n/server";
import type { Locale } from "@/i18n/config";
import { legalFacts, type LegalFacts, type LegalPage } from "@/lib/legal";
import { publicPageMetadata } from "@/lib/public-metadata";
import { siteConfig } from "@/lib/site-config";

function frPages({ plan, vat, support, abuse }: LegalFacts): Record<string, LegalPage> {
  return {
    "anti-abus": {
      title: "Politique anti-abus",
      intro: "Mail by Yodev est exclusivement réservé aux messages transactionnels attendus par leur destinataire.",
      sections: [
        ["Usages autorisés", "Un message doit être déclenché par une action utilisateur ou un événement métier documenté, envoyé à un destinataire unique et rattaché à un profil transactionnel approuvé."],
        ["Usages interdits", "Sont interdits : campagnes, newsletters, publicité, prospection à froid, scraping, listes achetées, louées ou échangées, phishing, usurpation, contenu illicite et contournement d’une suspension."],
        ["Contrôles", `Yodev examine l’identité, l’application, le domaine, le cas d’usage et les templates. Les quotas démarrent à ${plan.dailyLimit} emails par jour et n’augmentent qu’après observation de métriques propres.`],
        ["Suspension", "Toute plainte provoque une pause et une revue manuelle. Une pause intervient aussi à trois hard bounces, ou à un taux de hard bounce d’au moins 2 % après 50 envois."],
        ["Signalement", `Un abus peut être signalé à ${abuse} avec les en-têtes utiles. Ne transmettez pas de mot de passe ni de contenu sensible inutile.`],
      ],
    },
    confidentialite: {
      title: "Politique de confidentialité",
      intro: "Données traitées, finalités, bases légales, durées de conservation, cookies et droits relatifs à Mail by Yodev.",
      sections: [
        ["Responsable et sous-traitant", `Yodev, édité par Yoann Andrieux, entrepreneur individuel, est responsable des données de compte, d’administration et de facturation. Pour le contenu et les destinataires transmis par un client, Yodev agit comme sous-traitant sur instructions documentées de ce client (voir le DPA). Contact : ${support}.`],
        ["Données traitées", [
          "Compte et membres : nom, adresse email, photo de profil transmise par Google le cas échéant, rôle dans le workspace, clés publiques de passkey.",
          "Sessions : adresse IP et navigateur associés à chaque session de connexion.",
          "Workspace et facturation : raison sociale, domaines, paramètres, abonnement et identifiants Stripe. Les données de carte sont traitées directement par Stripe.",
          "Sécurité : journal des décisions administratives et compteurs de limitation de débit.",
          "Pour le compte des clients : adresses et noms d’expéditeur et de destinataire, contenu transactionnel, pièces jointes temporaires et événements techniques expurgés.",
        ]],
        ["Finalités et bases légales", [
          "Créer et administrer les comptes, authentifier les membres, fournir l’API et la console : exécution du contrat (art. 6.1.b RGPD).",
          "Sécuriser le service, prévenir les abus et protéger la réputation d’envoi : intérêt légitime de Yodev, de ses clients et des destinataires (art. 6.1.f).",
          "Facturer l’usage et tenir la comptabilité : exécution du contrat et obligation légale (art. 6.1.b et 6.1.c).",
          "Répondre aux demandes de support et aux signalements : exécution du contrat ou intérêt légitime.",
          "Livrer les messages des clients : traitement réalisé en tant que sous-traitant ; la base légale relève du client responsable de traitement.",
        ]],
        ["Durées de conservation", [
          "Corps des messages : 30 jours au maximum.",
          "Pièces jointes : 24 heures au maximum.",
          "Adresses et noms liés aux messages : remplacés après 90 jours ; événements techniques : supprimés après 90 jours.",
          "Suppressions (bounces, plaintes) : l’adresse en clair est retirée après 90 jours ; seule une empreinte non réversible est conservée pour empêcher un nouvel envoi.",
          "Sessions de connexion : 7 jours, prolongées à l’usage ; liens de vérification et de réinitialisation : 15 minutes.",
          "Données de compte et de workspace : pendant la durée d’utilisation du service, puis supprimées sur demande, sous réserve des obligations ci-dessous.",
          "Factures et pièces comptables : 10 ans (article L123-22 du Code de commerce).",
        ]],
        ["Cookies et stockage local", [
          "Cookie de session préfixé « yodev_mail. » (avec le préfixe __Secure- en HTTPS) : maintient la connexion pendant 7 jours au plus. Strictement nécessaire.",
          "Cookies temporaires d’authentification préfixés « yodev_mail. » pendant une connexion Google ou passkey : protègent le parcours et expirent en quelques minutes. Strictement nécessaires.",
          "Cookie « yodev_mail_locale » : mémorise la langue choisie pendant 12 mois.",
          "Préférence de thème : enregistrée dans le stockage local du navigateur (clé « theme »), jamais transmise au serveur.",
          "Aucun cookie de mesure d’audience, de publicité ni traceur tiers n’est déposé. Ces éléments étant strictement nécessaires ou liés à une préférence demandée par l’utilisateur, aucun consentement n’est requis et aucun bandeau n’est affiché. Les pages de connexion Google et de paiement Stripe appliquent leur propre politique.",
        ]],
        ["Destinataires et transferts", "Les données sont accessibles à Yodev et aux prestataires listés sur la page des sous-traitants, avec leur localisation. Certains sont établis aux États-Unis ; les transferts éventuels hors de l’Espace économique européen sont encadrés par les accords de traitement de données de ces prestataires."],
        ["Vos droits", `Vous pouvez demander l’accès, la rectification, l’effacement, la limitation, la portabilité de vos données ou vous opposer à un traitement fondé sur l’intérêt légitime en écrivant à ${support}. Une réponse est apportée dans un délai d’un mois. Pour les messages envoyés par un client, adressez-vous d’abord à ce client ; Yodev lui transmet votre demande. Vous pouvez introduire une réclamation auprès de la CNIL.`],
      ],
    },
    cgu: {
      title: "Conditions générales d’utilisation",
      intro: "Cadre d’utilisation et conditions financières de la bêta privée Mail by Yodev.",
      sections: [
        ["Clientèle", "Le service est destiné aux professionnels qui l’utilisent pour les besoins de leur activité. L’accès est nominatif, sur invitation et après validation du dossier. Le client protège ses clés Yodev et les révoque sans délai en cas de doute."],
        ["Service", "Mail by Yodev fournit une API transactionnelle. Le fournisseur de transport est choisi par Yodev et peut évoluer sans modifier le contrat API, sous réserve de la liste des sous-traitants. Les fonctions annoncées comme « bientôt » ne sont ni fournies ni facturées."],
        ["Obligations du client", "Le client garantit la licéité du traitement, l’exactitude de son dossier, la relation légitime avec chaque destinataire et le caractère strictement transactionnel des contenus."],
        ["Prix", `La bêta est facturée ${plan.monthly} par mois, plus ${plan.perEmail} par email accepté par le service de livraison. ${vat} Les simulations et rejets antérieurs à l’acceptation ne sont pas facturés.`],
        ["Facturation et paiement", "Les factures sont émises via Stripe et payables à réception, par le moyen de paiement enregistré. Aucun escompte n’est accordé en cas de paiement anticipé."],
        ["Retard de paiement", "Tout retard de paiement entraîne de plein droit, dès le lendemain de l’échéance, des pénalités de retard calculées au taux appliqué par la Banque centrale européenne à son opération de refinancement la plus récente, majoré de 10 points de pourcentage, ainsi qu’une indemnité forfaitaire pour frais de recouvrement de 40 € (articles L441-10 et D441-5 du Code de commerce). Une indemnité complémentaire peut être demandée sur justificatif lorsque les frais de recouvrement exposés dépassent ce montant. Le service peut être suspendu après une relance restée sans effet."],
        ["Suspension et résiliation", "Yodev peut suspendre immédiatement un workspace, domaine, profil, template ou accès en cas de risque, de plainte, d’impayé, d’information inexacte ou de violation de la politique anti-abus."],
        ["Limites techniques", "L’idempotence empêche la répétition d’une même requête côté Yodev. Un résultat fournisseur ambigu n’est jamais renvoyé automatiquement ; aucune garantie d’exécution exactement une fois n’est formulée."],
      ],
    },
    "mentions-legales": {
      title: "Mentions légales",
      intro: "Informations relatives à l’éditeur et à l’hébergeur de Mail by Yodev.",
      sections: [
        ["Éditeur", "Mail by Yodev est édité sous le nom commercial Yodev par Yoann Andrieux, entrepreneur individuel (EI)."],
        ["Immatriculation et activité", "Yoann Andrieux EI est immatriculé au Registre national des entreprises (RNE) et au Registre du commerce et des sociétés (RCS) de Paris sous le numéro SIREN 803 272 590. SIRET : 803 272 590 00024. Activité principale : programmation informatique (NAF/APE 62.01Z)."],
        ["Régime de TVA", vat],
        ["Adresse professionnelle", "7 allée des Jonquilles, 95130 Franconville, France."],
        ["Directeur de la publication", "Yoann Andrieux."],
        ["Contact", `${support}.`],
        ["Hébergement", "L’application est hébergée par Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis ; ses fonctions s’exécutent dans la région de Francfort (Allemagne). La base applicative est fournie par Neon dans la région AWS eu-central-1 (Francfort). Les autres sous-traitants sont listés sur la page dédiée."],
      ],
    },
    dpa: {
      title: "Accord de sous-traitance (DPA)",
      intro: "Conditions de traitement des données personnelles confiées à Mail by Yodev (article 28 du RGPD).",
      sections: [
        ["Objet et durée", "Yodev traite, pendant la durée du service et les périodes de rétention définies, les données nécessaires à la livraison des messages transactionnels pour le compte du client responsable de traitement."],
        ["Nature et finalité", "Réception par API, validation, mise en file, transmission au service de livraison, suivi des événements de livraison, bounce et plainte, gestion des suppressions et prévention des abus."],
        ["Personnes concernées", [
          "Destinataires des messages transactionnels du client (ses utilisateurs, clients ou partenaires).",
          "Personnes désignées comme expéditeur ou adresse de réponse par le client.",
          "Membres du workspace du client qui utilisent la console.",
        ]],
        ["Catégories de données", [
          "Adresses email et noms des expéditeurs, destinataires et adresses de réponse.",
          "Contenu des messages : objet, corps, variables de template et pièces jointes temporaires.",
          "Métadonnées techniques : identifiants, référence fournie par le client, horodatages, statuts, codes de bounce et de plainte, empreintes de suppression.",
          "Le service n’est pas conçu pour des catégories particulières de données (article 9 du RGPD) ; le client s’abstient d’en placer dans les contenus.",
        ]],
        ["Instructions", "Yodev n’agit que sur les instructions documentées résultant du contrat, du paramétrage du workspace et des requêtes API licites, sauf obligation légale contraire notifiée lorsque la loi le permet."],
        ["Confidentialité et sécurité", "Les personnes autorisées sont tenues à la confidentialité. Les accès sont limités, les secrets sont chiffrés, les pièces jointes sont temporaires et analysées, les files reçoivent uniquement des identifiants opaques, et les opérations administratives sensibles sont auditées."],
        ["Durées de conservation", "Corps des messages : 30 jours au maximum. Pièces jointes : 24 heures au maximum. Après 90 jours, les adresses et noms liés aux messages sont remplacés, les adresses de suppression en clair sont retirées et les événements techniques sont supprimés."],
        ["Sous-traitants ultérieurs", "Le client autorise les prestataires publiés dans la liste des sous-traitants. Un changement matériel est notifié dans un délai raisonnable afin de permettre une objection motivée."],
        ["Violation de données", `Yodev notifie au client toute violation de données personnelles le concernant sans délai injustifié et au plus tard 48 heures après en avoir pris connaissance, à l’adresse du propriétaire du workspace. La notification décrit, dans la mesure où ces informations sont connues, la nature de la violation, les catégories et le nombre approximatif de personnes et d’enregistrements concernés, les conséquences probables et les mesures prises ou proposées. Elle est complétée au fur et à mesure. Le point de contact est ${support}.`],
        ["Assistance", "Yodev assiste raisonnablement le client pour les droits des personnes, la sécurité, les violations de données, les analyses d’impact et les demandes d’autorités, compte tenu de la nature du traitement."],
        ["Fin du service et audit", "À la fin du service, les données sont supprimées selon les délais publiés, sauf obligation de conservation. Yodev fournit les informations raisonnablement nécessaires à la démonstration de conformité, sous réserve de confidentialité et de proportionnalité."],
      ],
    },
    "sous-traitants": {
      title: "Liste des sous-traitants",
      intro: "Prestataires susceptibles de traiter des données pour fournir Mail by Yodev, avec leur localisation.",
      sections: [
        ["Vercel", "Hébergement de l’application web et des fonctions HTTP. Société établie aux États-Unis ; les fonctions s’exécutent dans la région de Francfort (Allemagne, fra1) et les pages transitent par son réseau de diffusion. Les transferts éventuels sont encadrés par l’accord de traitement de données de Vercel."],
        ["Neon", "Base de données PostgreSQL managée, hébergée dans la région AWS eu-central-1 (Francfort, Allemagne). Les transferts éventuels liés au support sont encadrés par l’accord de traitement de données de Neon."],
        ["Amazon Web Services", "Files, fonctions, stockage temporaire des pièces jointes, chiffrement, analyse antivirus et paramètres chiffrés dans la région eu-west-3 (Paris, France). Amazon SES y est implémenté mais n’est pas utilisé pour la livraison en production à ce jour."],
        ["Postmark (ActiveCampaign)", "Transport transactionnel initial, authentification de domaine, événements de livraison, bounce et plainte, ainsi que les emails système (invitations, vérifications). Traitement aux États-Unis ; contenu réglé sur une rétention maximale de 28 jours. Les transferts sont encadrés par l’accord de traitement de données de Postmark."],
        ["Stripe", "Abonnement, facturation, paiement et portail client. Les données de paiement sont traitées directement par Stripe ; les transferts éventuels vers les États-Unis sont encadrés par l’accord de traitement de données de Stripe."],
        ["Google", "Fournisseur de connexion OAuth facultatif pour les membres invités : Google reçoit la demande de connexion et renvoie le nom, l’adresse email et la photo de profil. Les autres données d’authentification et d’organisation sont stockées par Yodev avec Better Auth."],
      ],
    },
    sla: {
      title: "SLA bêta et incidents",
      intro: "Niveaux de service applicables pendant la bêta privée.",
      sections: [
        ["Périmètre bêta", "La bêta est un service accompagné sans engagement de disponibilité financièrement garanti. Yodev vise une disponibilité mensuelle de 99,5 %, hors maintenance annoncée et dépendances externes."],
        ["Priorités", "Un incident critique empêche toute acceptation ou crée un risque de sécurité ; un incident majeur dégrade une fonction essentielle ; un incident mineur dispose d’un contournement acceptable."],
        ["Communication", `Les incidents critiques sont pris en charge en priorité et communiqués aux clients affectés par le canal disponible. Les demandes de support sont adressées à ${support}.`],
        ["Sécurité", "Une suspicion de violation, de clé compromise ou d’abus doit être signalée immédiatement. Yodev peut suspendre les envois pendant l’enquête et notifier les parties selon les obligations applicables."],
        ["Maintenance", "Les maintenances planifiées sont annoncées lorsque possible. Les changements de domaine sont drainés avant bascule et ne provoquent jamais de failover automatique d’un message déjà transmis."],
      ],
    },
  };
}

const legalSlugs = ["anti-abus", "confidentialite", "cgu", "mentions-legales", "dpa", "sous-traitants", "sla"] as const;

function legalPage(locale: Locale, slug: string) {
  const facts = legalFacts(locale);
  return (locale === "fr" ? frPages(facts) : enLegalPages(facts))[slug];
}

export function generateStaticParams() { return legalSlugs.map((legal) => ({ legal })); }

export async function generateMetadata({ params }: { params: Promise<{ legal: string }> }): Promise<Metadata> {
  const [{ legal }, locale] = await Promise.all([params, getLocale()]);
  const page = legalPage(locale, legal);
  if (!page) return {};
  return publicPageMetadata(locale, `/${legal}`, { title: page.title, description: page.intro });
}

export default async function Page({ params }: { params: Promise<{ legal: string }> }) {
  const [{ legal }, locale] = await Promise.all([params, getLocale()]);
  const page = legalPage(locale, legal);
  if (!page) notFound();
  return <PageShell eyebrow={locale === "fr" ? "Informations légales" : "Legal information"} title={page.title} intro={page.intro}><div className="mx-auto grid max-w-3xl gap-8">{page.sections.map(([title, body]) => <section key={title}><h2 className="text-xl font-semibold">{title}</h2>{typeof body === "string" ? <p className="mt-3 leading-7 text-muted-foreground">{body}</p> : <ul className="mt-3 grid list-disc gap-2 pl-5 leading-7 text-muted-foreground">{body.map((item) => <li key={item}>{item}</li>)}</ul>}</section>)}<p className="text-sm text-muted-foreground">{locale === "fr" ? `Dernière mise à jour : ${siteConfig.legalUpdatedAt.fr}.` : `Last updated: ${siteConfig.legalUpdatedAt.en}.`}</p></div></PageShell>;
}
