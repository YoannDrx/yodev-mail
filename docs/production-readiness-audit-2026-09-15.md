# YoDevMail - audit de préparation commerciale du 15 septembre 2026

## Verdict

Suivi : [implémentation du 15 septembre](production-hardening-2026-09-15.md).
Les corrections de ce lot sont distinctes de leur déploiement et des certifications externes.

**NO-GO commercial à ce jour.** Le produit est déployé et une part importante du
socle est testée. Cela ne constitue ni une certification opérationnelle complète,
ni une autorisation d'envoyer avec SES à des destinataires non vérifiés.

Les priorités sont : corriger la rétention en veille et le traitement des erreurs
Postmark incertaines ; terminer la certification applicative SES ; obtenir une
décision AWS favorable ; certifier facturation, restauration et exploitation.
L'acceptation AWS et la délivrabilité à 100 % ne peuvent pas être promises.

Ce rapport est la synthèse courante. Les anciens rapports restent des preuves
datées, pas des états actuels à additionner. En particulier, la checklist du
21 août mentionne un transport actif et des validations antérieures à plusieurs
changements : elle ne doit pas servir seule de feu vert aujourd'hui.

## 1. Périmètre et niveau de preuve

Audit en lecture seule des services ; seul ce compte-rendu est ajouté au dépôt.
Aucun envoi, paiement, migration, changement DNS, déploiement, purge, renouvellement
de droit pilote ou ouverture de fonctionnalité n'a été effectué.

- Code local `a2d7383`, contenu applicatif/infra/scripts identique à `origin/main`.
  GitHub `main` est toujours `100a9170adf608ae714a40fbe0c8a5a2a2c9dcd4`.
- Lecture ciblée des chemins critiques, tests associés, infrastructure, procédures
  et rapports des 6 à 11 septembre. Ce n'est pas un pentest exhaustif de chaque route.
- Vercel, endpoints publics, DNS publics et Neon relus le 15 septembre.
- Requêtes métier limitées au workspace interne
  `15734662-27a7-4bd8-b4bf-e6caed86a17a`, avec compteurs, états et dates uniquement.
  Aucune adresse de destinataire, aucun corps ni secret récupéré dans le rapport.
- AWS SSO : jeton expiré, renouvellement impossible avec la session existante.
  Aucun accès root de substitution. Statut SES, files, IAM et Support non relus
  aujourd'hui. Le dernier état SES confirmé date du 11 septembre.
- Stripe : connecteur en erreur de réauthentification. Compte, catalogue, clés,
  TVA et paiement non relus aujourd'hui. Reconnexion demandée.
- Postmark : pas de nouvel inventaire authentifié ; les paramètres AWS nécessaires
  au chemin habituel ne sont pas accessibles avec la session expirée.
- OVH : contrôle DNS public seulement, pas de revue du compte administrateur.

Les guides de revue du dépôt, de messagerie AWS, de protection des secrets,
d'observabilité Vercel, de Neon et de Stripe ont guidé la sélection des contrôles.
La revue distingue défaut démontré, risque de code et absence de preuve externe.

## 2. Photographie vérifiée aujourd'hui

| Élément | Observation | Interprétation |
| --- | --- | --- |
| Application et API | Deux health checks HTTP 200, `status=ok`, `database=ok`, version `100a917` | Web et DB disponibles au moment du contrôle, pas preuve d'envoi |
| Vercel | Déploiement `dpl_8agNMnY4wY2ni486yksqD2RTnSN9`, Production, `READY`, commit de main | Publication du 11 septembre toujours retrouvée |
| Logs Vercel | Requête `error`/`fatal` sur les dernières 24 h : aucun résultat retourné | Ne prouve ni l'exhaustivité de collecte/rétention, ni 72 h sous charge |
| En-têtes publics | HSTS, CSP, `frame-ancestors 'none'`, X-Frame-Options DENY | Protections présentes ; CSP autorise encore les scripts inline |
| Neon | `yodev-mail-db`, `free_v3`, région `aws-eu-central-1`, PostgreSQL 17 | Base européenne, pas certification de résidence de toute la chaîne |
| Reprise Neon | Historique 21 600 secondes (6 h), 10 branches pour une limite de 10, main non protégée | Capacité d'exercice saturée et fenêtre courte |
| Migrations | 10 entrées dans le journal Drizzle | Comptage relu, pas nouveau diff exhaustif de schéma |
| Comptabilisation interne | 35 acceptations live, 35 lignes de ledger, 0 discordance message par message | Historique cohérent sur le seul workspace audité |
| Travail restant en base | 0 réservation, 0 `sending`/`unknown`, 0 outbox en attente, 0 callback en attente | Aucun backlog métier constaté sur ce workspace |
| Activité récente | Aucun message live créé depuis le déploiement du 11 septembre | Le temps écoulé depuis le déploiement n'est pas un canari actif |
| Rétention | 3 contenus après expiration : 2 live/delivered, 1 test/simulated ; première expiration le 12 septembre à 13:57:16 UTC | Défaut réel, pas seulement risque théorique |
| Pièces jointes | 0 ligne non supprimée arrivée à expiration | Pas une lecture du contenu S3 ni une preuve de scan/purge réelle |
| Abonnement interne | `inactive`, aucun abonnement Stripe, pilote expiré le 12 septembre à 12:22:51 UTC | Les essais live applicatifs n'ont plus de droit pilote valide |
| Route SES applicative | 0 compte fournisseur SES et 0 binding SES sur le workspace interne | Une identité AWS vérifiée ne suffit pas à router l'application |
| Domaines applicatifs | 1 binding actif vérifié, non SES | Pas d'ouverture SES implicite |
| DNS SES public | SPF `include:amazonses.com ~all`, MX de bounce vers eu-west-3, DMARC `p=none` | DNS présents ; DKIM et états internes SES restent à relire |

### Consommation Neon

Lecture projet : 13 312 secondes de compute, soit environ **3,70 CU-heures**,
35,2 Mo de stockage synthétique et 0,24 Mo de transfert pour la période
**1er septembre - 1er octobre 2026**. À rythme constant de veille, l'extrapolation
est de l'ordre de 8 CU-heures sur le mois, pas une prévision en régime commercial.
La branche main représente environ 3,58 CU-heures et development 0,11 ; les huit
autres branches retournent zéro compute pour la période. Ces mesures concernent
YoDevMail, pas toutes les applications du compte.

Le motif pour revoir le forfait avant vente n'est donc pas une saturation de
compute observée aujourd'hui : c'est d'abord la reprise, la protection et la
capacité de test. Aucun achat ni suppression de sauvegarde n'est recommandé à
l'aveugle ; voir les [options Neon actuelles](https://neon.com/pricing).

## 3. Constats prioritaires

### P1 - La veille suspend aussi la suppression des contenus expirés

`infra/yodev-mail-stack.ts:199` désactive toutes les règles planifiées en standby,
y compris `RetentionPurgeSchedule` à la ligne 309. Le worker
`src/workers/purge-retention.ts:17` est le chemin de suppression des corps expirés.
Le contrat public (`src/app/[legal]/page.tsx`, section conservation) annonce un
maximum de 30 jours. La lecture Neon confirme trois écarts aujourd'hui.

À faire : dissocier entretien des données et envoi commercial ; maintenir une
purge contrôlée et surveillée même en veille, traiter l'arriéré avec une cible
explicite, puis vérifier que le compteur d'expiration reste nul. Ne pas activer
tous les workers pour corriger uniquement cette purge. Le cron quotidien actuel
peut aussi dépasser une échéance exacte de plusieurs heures : aligner cadence,
marge et formulation de la durée maximale.

Le worker effectue en outre des mutations globales sans workspace explicite,
sans lot borné ni curseur (`purge-retention.ts:23-56`), contrairement à la règle
du dépôt. Prévoir un traitement par workspace, paginé, réentrant et testé A/B.
Ce constat n'est pas une démonstration de fuite inter-client. Aucun effacement
n'a été exécuté durant cet audit.

### P1 - Les erreurs Postmark 500 autorisent encore un nouvel envoi

`src/features/providers/postmark.ts:65` classe tous les HTTP 5xx en `transient`.
`src/workers/send-email.ts:311-348` remet alors le message en attente pour une
nouvelle tentative. Le test `postmark.test.ts:39` confirme la règle générale sur
503, sans distinguer le cas 500.

La documentation Postmark indique qu'un message est perdu dans la plupart des
cas de 500, pas dans tous : l'absence d'acceptation n'est donc pas garantie.
**Risque de doublon**, non doublon observé dans les données de cet audit.
À faire : traiter les erreurs d'issue incertaine comme `unknown` sans relance,
conserver les refus réellement sûrs comme rejouables, et ajouter les tests de
classification et de réconciliation. Les textes bruts `payload.Message`
transmis aux diagnostics doivent également être normalisés.
[Contrat officiel des erreurs Postmark](https://postmarkapp.com/developer/api/overview).

Ce défaut bloque une réouverture Postmark, même si la cible commerciale finale
est SES. Il ne faut pas confondre le correctif SES déjà publié avec ce second
adaptateur. Les emails d'authentification utilisent eux aussi Postmark, via
`src/lib/auth-emails.ts` : un choix « SES pour les clients » ne supprime pas
automatiquement cette dépendance système.

### P1 de lancement - SES commercial non autorisé et route applicative absente

Dernière lecture AWS du 11 septembre : `ProductionAccessEnabled=false`, revue
`DENIED`. Lecture DB actuelle : aucun rattachement SES sur le workspace interne.
La chaîne complète n'a pas été certifiée sur ce déploiement. Le problème ne se
résout donc pas avec un simple `SES_ENABLED=true`.

### P1 de lancement - Paiement et reprise non certifiés

Dernière lecture Stripe du 11 septembre : paiements et virements désactivés,
informations de compte non soumises, exigences en retard. Aujourd'hui, session
expirée. Ces états restent à revérifier ; ils ne doivent pas être dits actuels
sans reconnexion. Le cycle commercial de bout en bout reste sans preuve finale.

La dernière branche de sauvegarde finale nommée date du 21 août. Sa création et
son schéma ne prouvent pas une restauration de la version finale avec bascule
applicative, ni un RTO opérationnel. Les dix branches sont conservées ; il faut
arbitrer leur cycle de vie ou augmenter la capacité avant un nouvel exercice.

### P2 - Suite infrastructure sensible à la concurrence

`npm test` : 298 réussites, 3 expirations de délai de 5 secondes dans
`ses-probe-stack.test.ts`, `ses-condition-probe-stack.test.ts` et
`test-account-stack.test.ts`. `npm test -- --no-file-parallelism` : **301/301**.
La dernière CI main reste verte. Stabiliser les budgets/concurrences de synthèse
et conserver les assertions ; ne pas masquer le premier échec ou déclarer la
commande par défaut verte aujourd'hui.

### P2 - Architecture, localisation et procédures à finaliser

- Dev et Prod applicatifs partagent encore le compte AWS de management selon la
  dernière preuve. Le compte test dédié n'est pas le compte production. Préférer
  des comptes membres de workload et séparer production/non-production ; AWS
  recommande de ne pas héberger les workloads dans le compte de management,
  auquel les SCP ne s'appliquent pas. Toute migration doit être planifiée et
  transparente pour le dossier SES, pas servir à éluder le refus.
  [Recommandations AWS](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices_mgmt-acct.html).
- Vercel retourne `regions: [iad1]`, Neon est en Europe et AWS workload est
  historiquement à Paris. Vérifier placement effectif des fonctions, latence et
  engagements contractuels ; ne pas présenter le service comme « 100 % UE ».
  Les pages actuelles mentionnent les transferts hors EEE, donc ce n'est pas une
  contradiction démontrée avec une promesse d'hébergement exclusivement européen.
- La documentation comporte encore des procédures de cutover historiques et
  des checklists d'août. Consolider un seul registre GO daté par fonctionnalité.
- Relire rôles d'administration, rotation des clés historiquement exposées,
  récupération d'accès et supervision hors session opérateur. Aucun secret
  compromis nouveau n'a été démontré aujourd'hui.

## 4. SES : acquis, manques et dossier AWS

### Acquis documentés, à ne pas refaire sans raison

- Adaptateur SES v2 avec une seule tentative SDK, timeout borné et traitement
  `unknown` pour les issues incertaines.
- Noms de tenants/configurations liés au workspace et à l'environnement ;
  contrôle IAM et association des identités, événements expurgés et isolation
  Dev/Prod renforcés.
- 10 septembre : **44 contrôles de provisioning et 12 contrôles d'envoi** réussis
  dans le compte test, dont seulement deux acceptations de mails simulateur.
  Ce n'est pas 56 livraisons. Le simulateur IAM garde dix divergences négatives,
  documentées et non présentées comme un résultat vert.
- 11 septembre : **deux autres envois** au simulateur avec retour réel
  SES → EventBridge → SQS, puis normaliseur applicatif local. Bug du champ
  `bounceType` vide corrigé et publié. Pas de Lambda d'ingestion/base/ledger
  dans cette sonde ; chiffrement de la sonde différent des files workload.
- Dernier déploiement AWS : Dev/Prod à jour, 26 workers en veille, 20 règles
  désactivées, aucun mapping SQS, files vides, trois stacks contrôlées sans dérive.
  Ces derniers points datent du 11 septembre, pas du présent audit.

Preuves : [sonde IAM réelle](ses-real-probe-2026-09-10.md),
[retour EventBridge/SQS](ses-transport-certification-2026-09-11.md),
[publication #49](https://github.com/YoannDrx/yodev-mail/pull/49#issuecomment-5632943248).

### Certification technique restante

1. Renouveler SSO et relire compte/région, état SES, identité DKIM/MAIL FROM,
   suppressions, quotas, destination EventBridge, IAM, règles, files et alertes.
2. Décider l'attribution de l'identité historique avant de la rattacher ; le code
   refuse volontairement d'adopter silencieusement une identité non attribuée.
3. Préparer deux workspaces synthétiques isolés, leurs profils/templates,
   domaines et clés ; renouveler uniquement le droit pilote prévu pour les tests.
4. Proviser un vrai compte/binding applicatif SES de certification avec les
   rôles réels, pas seulement les rôles de sonde.
5. Tester API → réservation/outbox → SQS → Lambda d'envoi → SES → EventBridge →
   SQS → Lambda d'ingestion → consultation des statuts/ledger. Exiger une seule
   acceptation et une seule comptabilisation malgré doublons/réordonnancement.
6. Tester rebond permanent/temporaire, plainte, suppression avant envoi,
   auto-pause, quota, erreur de permission, timeout et issue inconnue sans renvoi.
7. Exercer interruption/reprise, message malformé et DLQ avec données synthétiques,
   ainsi que la perte de livraison vers une cible EventBridge. Aucun événement
   SES brut contenant des données de mail ne doit être versé dans une DLQ.
8. Tester la réception sur des boîtes contrôlées Gmail, Microsoft et Apple,
   examiner l'authentification des messages et observer le service actif 72 h.

**Ces étapes techniques n'ont pas toutes besoin d'attendre l'approbation AWS.**
Le sandbox permet les destinataires vérifiés et le simulateur ; la certification
peut donc avancer dans ces limites. Les clés YoDevMail `ym_test_*`, elles, ne font
aucun envoi fournisseur : elles ne suffisent pas à cette preuve. Toute fenêtre
utilisant le chemin applicatif live reste limitée aux données synthétiques et
destinataires permis, avec périmètre et retour en veille explicites.
[Restrictions officielles SES](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).

### Dossier d'acceptation AWS

La dernière lecture du dossier Support `178463601800033` (audit du 6 septembre)
décrit un refus définitif du 12 août, une demande de réévaluation transactionnelle
du 22 août et un dossier fermé. Les détails SES conservaient l'ancien type
`MARKETING` et l'ancienne URL. **Ni l'état du dossier ni une éventuelle nouvelle
réponse n'ont été relus aujourd'hui.**

Ordre recommandé :

1. Relire l'historique complet et demander si AWS accepte une nouvelle évaluation
   du produit matériellement différent, sans répéter une demande identique.
2. Décrire exactement YoDevMail : passerelle SaaS multi-tenant exclusivement
   transactionnelle, gérée par Yodev pour ses clients. Ne pas la présenter comme
   un simple service d'emails internes si elle envoie pour plusieurs entreprises.
3. Montrer un site accessible et cohérent : API, exemples attendus, anti-abus,
   identité de l'entreprise, confidentialité, support et contact abus actifs.
4. Joindre les changements réellement déployés : onboarding manuel, vérification
   des domaines, profils/templates approuvés, absence de campagnes/imports,
   quotas progressifs, suppressions et suspension ; distinguer code, tests
   synthétiques et exploitation commerciale encore fermée.
5. Décrire l'origine des destinataires et le déclencheur de chaque catégorie.
   Fournir des exemples synthétiques, pas des listes ni contenus clients.
6. Donner le volume de départ réel, un plafond et un rythme de montée prudents.
   L'absence de client actuel doit être dite ; ne pas inventer volumes, contrats
   ou historique de réputation pour embellir le dossier.
7. Joindre les preuves techniques complètes lorsqu'elles existent, les procédures
   de traitement des plaintes/incidents et l'identité du responsable d'astreinte.
8. Attendre l'accord explicite pour le compte/région de production. Ne pas ouvrir
   les destinataires non vérifiés sur la seule base du dépôt de la demande.

Le SPF `~all` observé correspond à l'exemple AWS : ce n'est pas la cause démontrée
du refus. DMARC `p=none` est une politique d'observation, pas de rejet ; prévoir
l'analyse des rapports et un durcissement seulement après vérification de tous
les expéditeurs. Ni un DNS propre ni un compte dédié ne garantissent l'acceptation.
[MAIL FROM et SPF AWS](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html).

Trame de premier message, à compléter après reconnexion et **non envoyée** :

> Nous souhaitons savoir si une réévaluation est possible pour Mail by Yodev,
> dont le périmètre est désormais exclusivement transactionnel et diffère de
> l'ancien projet présenté. Le service est une passerelle multi-tenant sur
> invitation ; nous n'avons pas encore de clients en production. Nous ne
> demandons pas de contourner la décision précédente. Nous pouvons fournir
> l'historique des changements, les contrôles d'admission, les cas d'usage et
> les preuves des essais isolés. Les envois commerciaux restent désactivés.
> Pouvez-vous confirmer la procédure applicable et les éléments complémentaires
> nécessaires avant une nouvelle soumission ?

## 5. Matrice de sortie avant première vente

| Lot | Travail restant | Preuve exigée pour clôturer | Dépendance |
| --- | --- | --- | --- |
| Confidentialité | Purge indépendante de la veille, bornée par workspace ; arriéré ; politique des copies/sauvegardes | Compteur expiré nul, tests A/B, purge récurrente et alerte exercées | Correctif technique + accès AWS |
| Fournisseurs | Corriger Postmark 500/diagnostics ; certifier SES complet ; décider du transport système | Pas de renvoi ambigu, événement et ledger corrélés, essais négatifs verts | Accès AWS/Postmark |
| Autorisation SES | Dossier sincère et réévaluation autorisée | Accord AWS, production activée sur le compte/région retenu, état sain | AWS, sans délai garanti |
| Identités/domaine | Ownership historique, provisioning nouveau domaine, DKIM/MAIL FROM, rapports DMARC | Deux tenants isolés, association correcte, vérification réelle | AWS/DNS |
| Facturation | Compte dédié actif, catalogue test/live, clés restreintes séparées, portail/webhook, régime fiscal confirmé | Checkout, paiement, webhook rejoué, facture, usage réconcilié, impayé, résiliation et remboursement | Propriétaire + Stripe |
| Authentification | Google OAuth réel, invitation reçue, récupération et passkeys physiques/multinavigateurs | Parcours complet avec deux utilisateurs/tenants contrôlés | Comptes de test + email système |
| Webhooks clients | Endpoint contrôlé, signature, retries, terminal, révocation, filtrage SSRF | Réception réelle et reprise sans double traitement | Certification isolée |
| Pièces jointes | Upload, checksum/MIME, scan sain/malveillant, isolement et purge | Preuve GuardDuty/S3 jusqu'à livraison et expiration | Seulement si incluses dans l'offre |
| Reprise | Capacité de branche, restauration finale, bascule applicative, retour arrière | RPO/RTO mesurés de bout en bout, données réconciliées | Arbitrage Neon sans purge arbitraire |
| Exploitation | Moniteur externe, alarmes actives, destinataires confirmés, DLQ/unknown, budgets | Alerte réellement reçue, exercice incident, aucune donnée mail dans les logs | Choix d'exploitation et accès |
| Charge | Débit/latence API, délai outbox/SQS, connexions DB, quota fournisseur et noisy neighbor | Objectifs de service définis puis tests sous charge représentative | Après chaîne fonctionnelle |
| Juridique/offre | Informations entreprise/TVA, conditions, DPA, sous-traitants/transferts, SLA/support, fin de service | Validation humaine et parcours d'effacement/export exercé | Propriétaire/conseil compétent |
| Lancement | Ouvrir chaque capacité certifiée séparément ; canaris actifs et rollback | 72 h sans P0/P1, doublon, fuite, DLQ ou écart comptable inexpliqué | Tous les lots du périmètre vendu |

La validation fiscale ne se déduit ni de l'absence d'inscription Stripe Tax ni
du texte public « TVA non applicable ». Le régime réel doit être confirmé avant
le premier paiement, puis les paramètres alignés. Ajouter une inscription dans
Stripe ne réalise pas l'immatriculation auprès d'une autorité fiscale.
[Stripe : passage en live](https://docs.stripe.com/get-started/checklist/go-live),
[Stripe : inscriptions fiscales](https://docs.stripe.com/tax/registering).

Un lancement plus restreint est possible seulement si l'offre exclut explicitement
les fonctionnalités non certifiées et que leurs accès restent fermés. Raw,
pièces jointes et webhooks ne doivent pas être annoncés comme disponibles sans
preuve. Postmark pourrait être une voie commerciale distincte après ses propres
validations, mais ne répondrait pas à l'objectif « SES accepté ».

## 6. Ordre d'exécution proposé

1. **Sans attendre AWS** : correctifs rétention/Postmark, stabilisation des tests,
   consolidation de la matrice GO, choix du périmètre vendu.
2. **Rétablir les accès** : SSO AWS, Stripe, puis relecture Postmark et dernier
   dossier Support. Revoir les identités et le choix du compte cible avant de
   certifier définitivement une architecture qui devrait ensuite être déplacée.
3. **Certification isolée** : chaîne SES applicative et scénarios négatifs,
   restauration, authentification réelle et facturation sandbox. Pas de clients
   nécessaires pour ces preuves ; deux organisations synthétiques suffisent.
4. **Validation externe** : instruction AWS, activation Stripe par le propriétaire,
   fiscalité/contrats, capacité des fournisseurs. Ces délais ne sont pas maîtrisés
   par le code ; aucune date ferme de lancement n'est justifiable à ce stade.
5. **GO limité puis commercial** : finaliser les preuves live autorisées, supervision,
   canaris 72 h et rollback ; ouvrir seulement les fonctionnalités incluses et
   validées. Garder la décision GO signée et datée avec les preuves correspondantes.

Le travail restant ne consiste plus seulement à « finir le développement » :
il faut fermer des défauts précis puis produire les preuves d'exploitation et
les autorisations. Ne pas multiplier des sondes partielles en les assimilant à
un parcours de bout en bout.

## 7. Vérifications réalisées et limites

- `npm run lint` : réussi.
- `npm run typecheck` : réussi.
- `npm audit --json` : zéro vulnérabilité connue retournée.
- `npm test` : 3 timeouts infrastructure, 298 tests réussis.
- `npm test -- --no-file-parallelism` : 301 tests réussis dans 45 fichiers.
- `git diff --check` : réussi avant et après rédaction.
- Dernière CI main relue : [34587684304](https://github.com/YoannDrx/yodev-mail/actions/runs/34587684304),
  verte sur `100a917`. Les preuves du 11 septembre comprennent 426 tests complets
  et 16 parcours navigateur ; ces suites complètes n'ont pas été rejouées aujourd'hui.
- Aucun nouveau build, test de charge, pentest, exercice de restauration, envoi
  réel, paiement ou test Playwright durant cet audit. `npm run check` n'est pas
  annoncé vert aujourd'hui : sa commande de test par défaut a présenté des timeouts.
- Pas de lecture actuelle des gates distants Vercel ni de l'infrastructure AWS ;
  aucune modification de configuration présumée à partir du seul health check.
- Les fonctions « compte à jour »/« site disponible »/« mail accepté »/« mail reçu »/
  « facturé une fois »/« autorisé commercialement » sont des preuves différentes.

**Conclusion : conserver le NO-GO commercial. Le prochain lot prioritaire est la
rétention et la sécurité des reprises Postmark, suivi de la certification SES
applicative complète et de la réévaluation AWS, sans promesse d'approbation.**
