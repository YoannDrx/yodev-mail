# Checklist GO production et commercial

Ce document est la matrice de sortie de YoDevMail. Un statut `fermé` signifie
que la fonctionnalité échoue volontairement de façon sûre en production. Il ne
doit jamais être interprété comme une fonctionnalité certifiée.

## État au 18 août 2026

| Fonction | Preuve automatisée | Preuve externe | Gate production | Décision |
|---|---|---|---|---|
| Authentification Better Auth, organisations et isolation A/B | Verte | Deux propriétaires et deux workspaces en Preview | active | déployée |
| Membres, invitations et limite de trois sièges | Concurrence PostgreSQL verte | UI Production : un propriétaire, zéro invitation, limite trois | n/a | déployée, invitation réelle encore à exercer |
| Domaines, DKIM, Return-Path et DMARC | Verte | `yodev.fr` vérifié dans Postmark | active pour l'interne | prête pour l'interne |
| Profils et templates approuvés | Verte | template interne approuvé | active | second canari de marque requis |
| Clés test/live, scopes et révocation | Verte | clé live canari révoquée | active | prête pour l'interne |
| API transactionnelle, idempotence et quota | Concurrence PostgreSQL verte | Gmail livré, ledger unique | fermée après déploiement | second Gmail, Outlook, iCloud et 72 h requis |
| Événements fournisseur, suppressions et auto-pause | Concurrence et désordre verts | delivery Postmark réelle | active | bounce et complaint réels requis |
| Webhooks clients signés et retries | SSRF, signature, claim périmé et huit retries verts | aucun endpoint contrôlé réel | fermée | canari succès, échec et terminal requis |
| Pièces jointes | Scan, course malware, checksum, MIME, envoi et purge verts | GuardDuty/S3 actifs, aucun upload réel | fermée | canari upload, scan, Gmail et purge requis |
| Stripe Checkout et portail | Catalogue et état webhook partiellement couverts | compte connecté `RoutineKids`, pas YoDevMail | fermée | compte dédié et cycle complet requis |
| Facturation à l'usage | Claim et ambiguïté PostgreSQL verts | aucun meter event YoDevMail réel | fermée | meter, facture et réconciliation requis |
| Onboarding commercial | Réconciliation propriétaire verte | deux organisations en Preview | fermée | garder fermé jusqu'au GO commercial |
| AWS SQS/Lambda/EventBridge/KMS/CloudTrail | CDK et tests verts | stacks saines, files et DLQ vides | production active | prête, sous surveillance |
| SES | Code sandbox testé partiellement | compte encore sandbox | fermée | hors dépendance de lancement Postmark |
| Restauration Neon | Migrations et préflight verts | restauration mesurée en 864 ms | n/a | refaire après le déploiement final |
| Pages légales, DPA et sous-traitants | Build et E2E publics verts | contenu publié | active | validation juridique humaine requise |
| Support et abus | adresses publiées | connecteur Gmail expiré | n/a | réauthentifier et prouver les deux routages |

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
