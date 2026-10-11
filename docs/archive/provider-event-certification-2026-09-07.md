# Événements fournisseur - certification du 7 septembre 2026

## Périmètre et décision

Ce lot sécurise l'ingestion commune des retours SES/Postmark. Il poursuit
l'exigence de fiabilité et de protection de réputation de l'audit de production.
Il ne remplace pas la certification réelle API → SQS → SES → EventBridge →
worker → base et ne lève aucun blocage commercial. Les envois et paiements
restent fermés.

## Défauts reproduits avant correction

Trois tests PostgreSQL échouent sur le code de `bc8a9e0` :

1. Une erreur lors de la suspension automatique laisse la plainte, les
   compteurs et la suppression déjà committés. La reprise reconnaît l'événement
   comme doublon et ne retente plus la suspension. Le workspace peut donc
   rester approuvé malgré la plainte.
2. Un tag interne de message est accepté même si l'ID de message fournisseur
   contredit celui enregistré en base. Le mauvais message peut recevoir
   l'événement et déclencher des effets de réputation injustifiés.
3. Un tag interne inconnu/contradictoire provoque un fallback sur l'ID
   fournisseur, au lieu de traiter les identifiants contradictoires comme un
   échec de corrélation.

Ces tests utilisent uniquement des données synthétiques locales. Ils ne
démontrent pas une exploitation sur les données réelles.

## Corrections

- L'événement, le statut du message, les compteurs, la suppression éventuelle,
  les jobs de webhook et la suspension avec son audit sont dans une seule
  transaction. Une erreur de suspension ou d'audit annule tous ces effets ;
  le même événement peut être repris sans être éliminé comme doublon.
- Un verrou `FOR NO KEY UPDATE` sur le workspace sérialise ses événements avant
  le verrou du message. La décision de réputation tient ainsi compte des
  événements concurrents de messages/jours différents. Il reste compatible
  avec les vérifications de clé étrangère `FOR KEY SHARE`.
- La corrélation est revérifiée après acquisition du verrou du message :
  fournisseur identique, mode live et ID fournisseur cohérent s'il est déjà
  connu. Les retours ne changent pas les simulations de clés test.
- Sans tag interne, la recherche par ID fournisseur reste disponible, limitée
  explicitement au workspace et au fournisseur. Un tag présent mais
  contradictoire ne déclenche plus cette recherche de secours.
- Un événement correctement tagué arrivant pendant `sending`, avant
  l'enregistrement de l'ID fournisseur, reste accepté. Les doublons gardent
  leurs protections existantes ; une suspension manuelle n'est pas remplacée
  par un motif de réputation.

La sérialisation est par workspace, pas globale. Son impact sous charge et sur
le pooler Neon doit être mesuré lors de la certification active. Aucune requête
fournisseur externe n'est exécutée dans cette transaction. Les événements
contradictoires sont ignorés sans effet métier ; ce lot ne crée pas encore un
dispositif opérateur dédié à leur réconciliation.

## Preuves de tests

Dix nouveaux tests PostgreSQL couvrent : erreur de suspension, erreur d'audit,
reprise, doublon concurrent, seuil de trois hard bounces sur des jours
différents, suspension manuelle, identifiants contradictoires, absence de
workspace, mauvais fournisseur, mode test, événement précoce et changement
d'identité pendant une attente de verrou observée dans PostgreSQL.

Les trois reproductions initiales et les 37 tests existants des chemins
critiques passent ensemble après correction. Les dix tests du nouveau fichier
passent également. Les vérifications globales et la publication sont à
consigner ci-dessous.

Base de test : PostgreSQL 17.11 isolé sur `127.0.0.1:55443/yodev_mail_test`,
avec les dix migrations existantes. Les triggers de faute sont créés et
supprimés uniquement dans cette base locale. Aucun trigger, migration,
correctif de données ou changement de secret n'est appliqué en production.

## Limites et suites

- La validation runtime complète du contrat des événements en file et les
  cas de normalisation malformée restent à approfondir : les types TypeScript
  ne sont pas une validation des corps SQS.
- Rejouer la chaîne réelle SES dans un périmètre isolé, notamment les retours
  de livraison, rejet, rebond et plainte. Les dix nouveaux tests ciblent
  l'ingestion DB, pas le transport AWS ni la délivrabilité.
- Vérifier que les données historiques n'exigent pas une réconciliation de
  suspension après un ancien incident. Ce lot ne change aucune donnée réelle.
- L'approbation production SES, la certification Postmark réelle, Stripe Live,
  la restauration, la supervision et les 72 heures d'observation restent des
  exigences distinctes de l'objectif global.

## Sources officielles

- [Lambda avec SQS](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html) :
  traitement au moins une fois et nécessité de supporter les doublons.
- [Événements SES dans EventBridge](https://docs.aws.amazon.com/ses/latest/dg/monitoring-eventbridge.html) :
  contrat de transport à certifier dans la suite.
- [Verrous PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html) :
  incompatibilités des verrous de ligne et libération transactionnelle.

## Vérification finale et publication

Vérifications locales sur le code stabilisé :

- `npm run check` : lint, TypeScript, 188 tests unitaires et build verts.
- `npm run test:coverage:full` : 298 tests dans 45 fichiers, tous verts ;
  78,71 % des lignes, 71,42 % des branches. Seuils conservés. L'ingestion
  commune atteint 100 % des lignes et 97,59 % des branches sur ces scénarios.
- Diff CDK Dev/Prod : seul l'asset du worker `ProviderEvents` change dans
  chaque stack. Aucune permission, variable, ressource de stockage ou migration
  ne change ; aucun remplacement et fondation exclue.

Les huit parcours Playwright publics passent localement en une minute.
`agent-browser` n'est pas installé : ces scénarios sont la preuve navigateur
locale, sans contrôle visuel supplémentaire. La CI obligatoire, dont les
parcours authentifiés, reste requise avant fusion. Aucun GO commercial ne sera
déduit de ce lot seul.

### Publication vérifiée le 7 septembre à 01 h 37 (Paris)

- [PR #40](https://github.com/YoannDrx/yodev-mail/pull/40) fusionnée à
  01 h 34 min 20 s, sans contournement des protections ; tête testée
  `e698737bdac8196935440046b08b1a6e795de0cc`, commit de fusion
  `192ddabd56b43b2f5d1f4ea335293ae14f2d0094`. Arbres identiques.
- CI de PR `34067025366` et CI de `main` `34067264562` entièrement vertes,
  y compris les huit parcours authentifiés ; GitGuardian et Vercel verts.
- AWS Dev `UPDATE_COMPLETE` à 01 h 35 min 35 s, puis Prod à
  01 h 36 min 26 s. Seul le code de `ProviderEvents` est actualisé dans chaque
  environnement. Hash Lambda Prod : `lDjDJ7/SyIdjulNHXdha1tP3I8X6i2Kw7ztQaPXmCQ0=`.
- Vercel Production `dpl_A6moRRZxz3aPZCdixdEQsYffka3X` est `READY` sur le
  commit de fusion. `https://api.mail.yodev.fr/health` retourne
  `status=ok`, `database=ok`, `version=192ddab`. Le health de
  `https://mail.yodev.fr` redirige vers cette API ; l'onboarding anonyme
  redirige vers `/fr/connexion`.
- Les 26 workers restent en standby, SES et Postmark désactivés ; aucun
  mapping Lambda/SQS. Les files `provider-events` Dev/Prod et leurs DLQ ont
  chacune zéro message visible, en cours ou différé. Aucun message envoyé,
  rejoué, purgé ou consommé pour cette publication.
- Aucun log Vercel `error`/`fatal` retourné pour ce déploiement sur la courte
  fenêtre postpublication. Ce contrôle n'est pas une observation de 72 heures.

Lecture Neon ciblée, sans mutation ni contenu d'email : le workspace interne
`15734662-27a7-4bd8-b4bf-e6caed86a17a` est `approved`, sans motif de pause.
Le regroupement de tous ses types d'événements ne contient ni
`email.complained` ni `email.hard_bounced` ; ses compteurs correspondants sur
sept jours et ses audits de suspension automatique sont nuls. Aucune réparation
de suspension n'est donc justifiée par ces données. Ce constat ne porte pas
sur d'autres workspaces. La première requête ayant omis le préfixe `email.`
des types, le contrôle a été confirmé par le regroupement exhaustif des types.

SES relu dans `eu-west-3` : accès production `false`, revue `DENIED`, compte
`HEALTHY`, sandbox 200/jour et 1/seconde, zéro envoi sur 24 heures. Identité
`mail.yodev.fr` vérifiée, DKIM RSA 2048 `SUCCESS`, MAIL FROM
`bounce.mail.yodev.fr` `SUCCESS` avec `REJECT_MESSAGE`. L'approbation AWS et
la certification complète du transport restent ouvertes ; aucun GO commercial.
