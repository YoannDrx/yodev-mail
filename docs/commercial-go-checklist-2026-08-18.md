# Checklist GO production et commercial

Ce document est la matrice de sortie de YoDevMail. Un statut `fermé` signifie
que la fonctionnalité échoue volontairement de façon sûre en production. Il ne
doit jamais être interprété comme une fonctionnalité certifiée.

## État actualisé au 21 août 2026

Version de production observée : `4df89d8`. La branche de consolidation
`codex/mail-commercial-go` a été fusionnée par la PR `#26`; les workers AWS ont
été redéployés le 21 août 2026 avec SES et le reporting d'usage fermés. Les
données personnelles sans
utilité légale (numéro de sécurité sociale, identifiant Urssaf et informations
de naissance) sont explicitement hors périmètre de tous les systèmes Mail by
Yodev.

| Fonction | Preuve automatisée | Preuve externe | Gate production | Décision |
|---|---|---|---|---|
| Authentification Better Auth, organisations et isolation A/B | Verte | Deux propriétaires et deux workspaces en Preview | active | déployée |
| Membres, invitations et limite de trois sièges | Concurrence PostgreSQL verte | UI Production : un propriétaire, zéro invitation, limite trois | n/a | déployée, invitation réelle encore à exercer |
| Domaines, DKIM, Return-Path et DMARC | Verte | `yodev.fr` vérifié dans Postmark | active pour l'interne | prête pour l'interne |
| Profils et templates approuvés | Verte | template interne approuvé | active | second canari de marque requis |
| Clés test/live, scopes et révocation | Verte | clé de canari minimale créée; une clé historique Ads by Yodev reste active | active | révoquer la clé historique puis la clé canari après usage |
| API transactionnelle, idempotence et quota | Concurrence PostgreSQL verte | Gmail livré, ledger unique | fermée après déploiement | second Gmail, Outlook, iCloud et 72 h requis |
| Événements fournisseur, suppressions et auto-pause | Concurrence et désordre verts | delivery Postmark réelle | active | bounce et complaint réels requis |
| Webhooks clients signés et retries | SSRF, signature, claim périmé et huit retries verts | aucun endpoint contrôlé réel | fermée | canari succès, échec et terminal requis |
| Pièces jointes | Scan, course malware, checksum, MIME, envoi et purge verts | GuardDuty/S3 actifs, aucun upload réel | fermée | canari upload, scan, Gmail et purge requis |
| Stripe Checkout et portail | Catalogue, idempotence et trois modes fiscaux couverts ; `unconfigured` bloque le checkout | produit sandbox, deux prix, branding, portail et webhook 10 événements vérifiés | fermée | rotation des clés test, installation Preview et cycle sandbox puis live requis |
| Facturation à l'usage | Claim et ambiguïté PostgreSQL verts | aucun meter event YoDevMail réel | fermée | meter, facture et réconciliation requis |
| Onboarding commercial | Réconciliation propriétaire verte | deux organisations en Preview | fermée | garder fermé jusqu'au GO commercial |
| AWS SQS/Lambda/EventBridge/KMS/CloudTrail | CDK et tests verts | rôle SSO non-root, stacks sans drift, files et DLQ vides, aucun remplacement stateful et aucune alarme active après déploiement | production active | prête, sous surveillance |
| Accès opérateur AWS | n/a | root sans clé et avec MFA; SSO CLI vert; utilisateur IAM administrateur historique encore présent | n/a | valider SSO web puis supprimer l'accès IAM historique |
| SES | Input CDK explicite, défaut fermé et veille toujours fermée | sandbox saine, identité/DKIM/MAIL FROM valides ; tenant et configuration set de certification créés ; 4 scénarios simulateur, 6 événements EventBridge → SQS → Lambda, file/DLQ à zéro | fermée | transitions d'un vrai message applicatif après approbation AWS uniquement |
| Capacité Postmark | n/a | compte approuvé et live, 30/100 emails Developer consommés | envoi disponible | passer au forfait Basic 10 000 avant commercialisation |
| Restauration Neon | Migrations et préflight verts | branche finale créée après déploiement en 0,47 s, 10 migrations et schéma identique à `main` | n/a | preuve finale acquise ; conserver la branche jusqu'à la fin de l'observation |
| Pages légales, DPA et sous-traitants | Build et E2E publics verts | contenu publié | active | validation juridique humaine requise |
| Support et abus | adresses publiées | sondes Gmail envoyées et reçues sur les deux alias | n/a | certifiée |

## GO interne

Le GO interne n'est accordé que lorsque Gmail, Outlook et iCloud ont chacun reçu
le même canari de marque,
que les files et DLQ restent vides, qu'aucun état `unknown` ou réservation
incohérente n'apparaît et que l'observation de 72 heures est terminée.

Les pièces jointes, webhooks clients, Stripe, contenu brut et onboarding
commercial peuvent rester fermés pour ce GO. Ils ne doivent pas être présentés
comme disponibles au pilote tant que leur ligne de la matrice n'est pas verte.

## GO commercial

Le GO commercial exige en plus :

1. un compte Stripe YoDevMail dédié, une clé restreinte, un catalogue vérifié,
   une immatriculation Stripe Tax cohérente et un cycle réel checkout, paiement,
   webhook, facture, portail, annulation et remboursement ;
2. un meter event réel réconcilié avec le ledger et la facture, plus une procédure
   exercée pour les jobs `unknown` et `unreportable` ;
3. le canari complet des pièces jointes et celui des webhooks clients ;
4. un bounce et une plainte contrôlés prouvant suppression et auto-pause ;
5. une restauration Neon après la version finale, avec RPO et RTO consignés ;
6. la validation humaine des CGV, du DPA, des sous-traitants, de la fiscalité et
   des mentions d'entreprise ;
7. un forfait Postmark adapté au volume de production et des budgets/alertes
   acceptés ;
8. au moins un second tenant commercial réel dont l'isolation, l'onboarding,
   l'annulation et la suppression de données sont exercés.

## Règle de lancement

Le produit peut être déployé ce soir avec les fonctions non certifiées fermées.
Il ne peut pas être honnêtement déclaré entièrement commercialisable ce soir :
la fenêtre d'observation de 72 heures, les boîtes Outlook/iCloud, le compte Stripe
dédié et les validations juridiques/fiscales dépendent d'un délai ou d'une action
humaine externe. Aucun contournement technique ne transforme ces dépendances en
preuve de production.

## Inventaire de retrait de l’ancien compte Stripe

Cet inventaire ne contient aucune clé ni valeur secrète. Il borne strictement le
nettoyage au produit Mail by Yodev de l’ancien compte. Les factures, paiements,
événements et traces comptables historiques sont conservés.

- compte : `acct_1MpyGWH4VwBfiTEI` ;
- produit actif : `prod_V1zpL3F0gPRjNB` ;
- prix actifs : `price_1U3cXIH4VwBfiTEI7vp2qUP1`,
  `price_1U3cXIH4VwBfiTEI9TCAz36U`,
  `price_1U1vpXH4VwBfiTEI9ejvDsGQ`,
  `price_1U1vpXH4VwBfiTEIQzGBGlME`,
  `price_1U1vpXH4VwBfiTEIeZBS2Or3`,
  `price_1U1vpXH4VwBfiTEIOTr0Zlj3`,
  `price_1U1vpWH4VwBfiTEIGQAQHKgf` et
  `price_1U1vpWH4VwBfiTEI4Wt7paNq` ;
- meter actif : `mtr_61VBJmsn1wmXwsclF41H4VwBfiTEITSC` ;
- webhook actif : `we_1U3ceAH4VwBfiTEIhd2wRhan` ;
- webhook déjà désactivé : `we_1U1vpaH4VwBfiTEIyroviRNL` ;
- aucun abonnement actif ni Payment Link Mail identifié lors de l’inventaire.

## Inventaire Stripe sandbox dédié

- compte test : `acct_1U6ShH8ntWMjJBwn` ;
- produit : `prod_V6omdnw26NQY8D` ;
- prix plateforme 29 EUR/mois : `price_1U6b8k8ntWMjJBwnFMEYHcem` ;
- prix usage 0,0025 EUR/email : `price_1U6b8k8ntWMjJBwnt7Eai8Dt` ;
- meter actif : `mtr_test_61VFs0ei8uhP4r4jr418ntWMjJBwn2yu`, événement
  `yodev_mail_emails_sent` ;
- webhook actif : `we_1U6bFD8ntWMjJBwnGfrjHsAR`, limité aux dix événements
  checkout, subscription et invoice traités par le code ;
- portail : factures, moyen de paiement et annulation en fin de période actifs,
  changement de plan désactivé ;
- branding Mail by Yodev appliqué ;
- les clés test affichées par le Dashboard pendant l'audit doivent être
  renouvelées avant toute certification. La future clé runtime et la future clé
  d'usage sont séparées par `STRIPE_SECRET_KEY` et
  `STRIPE_USAGE_SECRET_KEY`.

## Preuve SES sandbox

- tenant isolé : `ym-sandbox-cert` ;
- configuration set : `ym-sandbox-cert-txn` ;
- destination EventBridge : `yodev-mail-eventbridge`, événements delivery,
  bounce, complaint, reject et delivery delay ;
- ressources associées : identité `mail.yodev.fr` et configuration set de
  certification uniquement ;
- scénarios du simulateur AWS : success, bounce, complaint et out-of-office ;
- résultat : six records consommés avec `outcome=completed`, file et DLQ vides,
  aucune alarme et aucune suppression de compte ;
- limite : les identifiants de certification ne correspondent volontairement à
  aucun message client. Les transitions de base seront exercées seulement dans
  un environnement de certification explicitement ouvert après l'accord SES
  Production, sans activer le binding en production.

## Preuve Neon finale

- projet : `round-star-39482619` (`vigie-mail-db`) ;
- branche : `backup-final-commercial-go-20260821`
  (`br-summer-fog-asoqn1zj`), parent `main`, sans auto-suppression ;
- fork Neon annoncé en 0,47 seconde ;
- PostgreSQL `17.11`, dix migrations Drizzle et tables critiques présentes ;
- comparaison de schéma enfant/parent vide ;
- RPO : instant de création de la branche ; RTO technique de mise à disposition
  du fork : 0,47 seconde. Le RTO opérationnel complet reste borné par le runbook
  de bascule Vercel et doit rester inférieur à quatre heures.

Avant archivage ou suppression, revalider les consommateurs de ces identifiants
dans Vercel, AWS, GitHub et Ads by Yodev. L’archivage du meter, des prix et du
produit, la suppression des webhooks et toute révocation de clé exigent une
confirmation opérateur immédiatement avant la mutation.
