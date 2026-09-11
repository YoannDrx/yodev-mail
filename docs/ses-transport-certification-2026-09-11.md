# SES : retour réel EventBridge/SQS - 11 septembre 2026

**Pas de GO commercial ni de certification de la chaîne applicative complète.**
Deux messages synthétiques ont été acceptés par SES dans le compte de test
`764858776290`, région `eu-west-3`. Leurs événements Delivery ont traversé
EventBridge et SQS. Le premier a révélé un défaut réel du consommateur.

## Défaut reproduit et correction

Le transformateur déployé utilise `$.detail.bounce.bounceType`, y compris pour
les événements qui ne sont pas des bounces. L'événement Delivery réel arrive
dans SQS avec `bounceType: ""`, et non avec un champ absent. Le schéma du
consommateur refusait cette chaîne vide ; l'événement aurait été réessayé puis
placé en DLQ par le transport actif, sans mise à jour métier.

La sonde s'est arrêtée avant le second envoi et sans acquitter le premier
événement. Quatre tests locaux ont ensuite reproduit l'échec sur Delivery,
Complaint, Reject et DeliveryDelay. Le schéma accepte maintenant la chaîne vide
pour ces événements sans inventer de raison. Un véritable Bounce avec une
classification vide reste refusé, les classifications existantes sont conservées.

Après correction, le **même événement Dev** a été relu et accepté par le
normaliseur du produit, sans renvoyer le message. Le second cas Prod a ensuite
été exécuté une seule fois. Les deux événements sont refusés par le normaliseur
configuré pour l'environnement opposé. Seuls ces deux événements de test
identifiés et validés ont été acquittés ; aucune purge.

| Cas dans le compte de test | Message applicatif synthétique | Événement EventBridge | Résultat |
| --- | --- | --- | --- |
| Dev | `9000bcca-a533-4257-8836-8b916f665908` | `7edafa0e-bf02-f3a9-137f-0f139d447230` | Refus avant correction, accepté lors de la relecture |
| Prod | `7f83846d-e712-4c07-9b7e-c6798d496f5f` | `5b8032ca-b79f-02f8-847f-59293b42756b` | Accepté après correction |

Identifiants SES opaques :

- Dev : `011301a08fe8c1f5-01ee4cf2-1dc1-4d70-af8e-5a2d38534c5f-000000`.
- Prod : `011301a08fead6e9-a5a79381-1733-41ee-82ea-a53a6b1d4cee-000000`.

Une tentative de continuation Prod a été arrêtée par les compteurs SQS encore
non nuls après l'acquittement Dev, avant tout SendEmail. Après lecture des quatre
files à zéro, la continuation a réussi. Aucun contrôle n'a été désactivé et
aucun message incertain n'a été renvoyé.

## Périmètre et sécurité

- Stack dédiée `YodevMailSesTransportProbe`, compte/région imposés ; aucun secret
  statique, aucune base ou Lambda applicative dans cette sonde.
- Deux règles et deux destinations sur les seules configurations de sonde
  `ym-{dev|prod}-ses-probe-20260910a-txn` déjà certifiées. Les identités DNS,
  tenants et rôles candidats existants ne sont pas recréés.
- Une clé KMS avec rotation, deux files principales et deux DLQ, TLS imposé,
  permissions EventBridge bornées par SourceAccount et SourceArn. Les files et
  la clé sont conservées ; rétention des messages 1 jour, DLQ 2 jours.
- Pas de DLQ de cible EventBridge : elle pourrait conserver l'événement SES
  original avec ses données de mail. Les DLQ SQS de cette sonde ne peuvent
  recevoir que les corps déjà transformés. Les erreurs de livraison de cible
  restent une limite de certification, sans prétendre disposer d'une reprise durable.
- Même filtre de base et même transformation que le produit, partagés dans
  `infra/ses-event-contract.ts`. Ajout d'un filtre de configuration de sonde.
  Avant correction du consommateur, cette extraction produit un diff AWS
  Dev/Prod strictement vide. La sonde utilise KMS ; les files du workload
  utilisent actuellement SSE-SQS, ce qui reste une différence à certifier.
- Seules huit propriétés techniques sont acceptées dans les événements reçus.
  Aucun corps SES brut, adresse, contenu ou diagnostic libre n'est affiché ou
  enregistré par le script. Les réponses AWS restent en mémoire.
- Profil SSO imposé ; précontrôle de l'identité opérateur, sandbox SES sain,
  DKIM/MAIL FROM, associations exactes du tenant, destinations, règles, cibles,
  transformation et files. Aucun envoi en cas de divergence.
- Destinataire fixé dans le code au simulateur de succès AWS ; au plus deux
  envois par exécution normale. `maxAttempts=1` et délai borné, sans retry de
  SendEmail. Relecture possible avec un reçu exact, sans nouvel envoi.
- Pas de modification Vercel, Neon, Stripe ou Postmark pendant cette sonde.

## Vérifications

- Synthèses strictes passive et active ; validation `cdk-nag` explicite verte,
  sans nouvelle exception. Stack créée le 11 septembre à 09:59:16 UTC.
- Détection de dérive après création : `IN_SYNC`, zéro ressource en dérive.
- 43 tests ciblés après correction ; 426 tests complets dans 56 fichiers passent
  sur PostgreSQL local synthétique. Couverture : lignes 74,05 %, branches 66,06 % ;
  seuils inchangés. Les scripts opérateur restent partiellement couverts en unitaires.
- Huit parcours navigateur publics passent après correction. Le test de synthèse
  de la sonde a dépassé 5 s lors de plusieurs suites concurrentes sur le poste ;
  son budget seul est porté à 30 s, sans retrait d'assertion de conformité.
- `npm run check` repasse ensuite : lint, types, 301 tests unitaires/infrastructure
  et build réussis.
- Les huit parcours authentifiés ne sont pas rejoués localement pour ce lot ;
  leur job CI reste requis avant fusion.

La revue des risques, les guides AWS CDK/SDK et les contrôles navigateur ont
guidé le périmètre isolé, les permissions, le non-rejeu d'envoi et les régressions.
`agent-browser` absent : les scénarios Playwright du dépôt sont utilisés.

## Exécution opérateur

Ne pas charger `.env.local` pour les sondes. Préparer un assemblage passif et un
assemblage actif avec l'app `infra/test-account-app.ts`, contexte
`sesTransport=true` ; seul `sesTransportEnabled=true` active les deux règles et
destinations. Toujours relire le diff, déployer exclusivement cette stack et
remettre l'assemblage passif après les essais.

```sh
npx tsx scripts/certify-ses-transport.mts --preflight
npx tsx scripts/certify-ses-transport.mts --send-two
# Seulement si le deuxième cas n'a jamais été envoyé :
npx tsx scripts/certify-ses-transport.mts --send-prod
# Pour relire un message déjà accepté, utiliser les quatre valeurs du reçu :
npx tsx scripts/certify-ses-transport.mts --observe ENV WORKSPACE_ID MESSAGE_ID SES_MESSAGE_ID
```

Ne jamais relancer `--send-two` après une issue incertaine. Une file occupée ou
un reçu contradictoire exige une réconciliation, pas une purge. Le script ne
met pas lui-même la stack en veille : cette étape opérateur reste obligatoire.

## Ce qui reste ouvert

La sonde ne passe pas par l'API publique, l'outbox, le worker d'envoi, une Lambda
d'ingestion ou le ledger en base. Elle utilise le normaliseur applicatif local
sur de vrais événements SQS. Elle ne valide pas la livraison chez Gmail,
Microsoft ou Apple, les bounces/plaintes réels, les alertes et la reprise en DLQ.
Le test inter-environnement est une vérification du consommateur local ; il ne
suffit pas à prouver l'absence de tout événement mal routé sous charge.

L'accès commercial SES reste une décision AWS distincte. Les autres prérequis
de [l'objectif global](production-implementation-2026-09-06.md) restent ouverts.

## Sources

- [SES vers le bus EventBridge par défaut](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-eventbridge.html).
- [Transformations des entrées EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html).
- [Permissions des cibles EventBridge et KMS](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html).
