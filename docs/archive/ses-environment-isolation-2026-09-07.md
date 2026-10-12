# Isolation des événements SES Dev/Prod - 7 septembre 2026

## Défaut confirmé

Les règles déployées `YodevMailDev-SesEventRule360ABB91-3ZiEpa1WkZUw` et
`YodevMailProd-SesEventRule360ABB91-RM7IgSNwwxNB` avaient le même filtre SES,
sans environnement. Le 7 septembre, `TestEventPattern` exécuté dans AWS a
confirmé qu'un événement synthétique portant `ym_environment=prod` correspondait
aux **deux** règles. Elles étaient désactivées. Ce test démontre une lacune de
routage avant activation, pas un incident historique ou une livraison réelle.

Le worker acceptait aussi un événement d'un autre environnement. Dix assertions
des tests expéditeur/consommateur échouaient avant correction.

## Corrections coordonnées

1. L'expéditeur SES impose un `DEPLOYMENT_ENVIRONMENT` explicitement `dev` ou
   `prod` avant tout appel fournisseur. Une valeur absente ou ambiguë donne une
   erreur définitive `ses_environment_invalid` sans envoi. Les tags existants
   conservent leurs UUID ; un tag technique `ym_environment` est ajouté.
2. Chaque règle EventBridge filtre sur son environnement, le compte et la région
   de sa stack. Son transformateur transmet l'environnement dans l'enveloppe
   technique, sans adresse ni contenu d'email.
3. Le consommateur SES valide l'environnement reçu et le compare à celui du
   worker avant ingestion. Un événement absent, inconnu ou mal routé reste un
   échec de contrat SQS, sans effet métier. Aucune déduction à partir d'un
   workspace potentiellement copié entre branches de base.

Le contrat Postmark n'est pas modifié dans ce lot. Ses callbacks restent
authentifiés et limités au workspace via leur binding ; aucun nouveau champ
d'environnement n'est requis pour ses enveloppes existantes.

## Vérifications avant publication

- 11 tests ajoutés : cinq expéditeur, cinq consommateur, un test structurel CDK
  sur les stacks standby, certification et production. 72 tests ciblés verts.
- `npm run check` vert : lint, TypeScript, 221 tests unitaires et build.
- Couverture complète : 332 tests / 46 fichiers, 79,64 % des lignes,
  72,40 % des branches. Seuils inchangés.
- `TestEventPattern` AWS sur les patterns de l'assembly CDK corrigé : 16/16.
  Pour chaque environnement, huit cas : événement Dev, Prod, sans environnement,
  environnement inconnu, autre compte, autre région, tracking Open et workspace
  manquant. Seul l'événement du bon environnement correspond.
- Ces appels AWS testent les patterns sans publier d'événement sur le bus,
  sans écrire en file et sans envoyer d'email. Ils ne simulent pas l'exécution
  réelle du transformateur EventBridge ni le transport Lambda/SQS.
- Diff CDK : code des deux workers `SendEmail` et `ProviderEvents`, plus pattern
  et transformateur de la règle SES, dans chaque environnement. Pas de
  remplacement, permission, stockage, schéma, secret ou fondation modifié.

Les huit parcours navigateur publics passent localement en 9,9 secondes.
`agent-browser` absent : contrôle effectué par Playwright, sans inspection
visuelle supplémentaire. Les preuves de CI et publication sont consignées
ci-dessous.
Dernière lecture SES avant publication : accès production `false`, revue
`DENIED`, zéro envoi sur 24 heures dans `eu-west-3`.

## Déploiement et reprise

Le changement doit être publié en standby pour coordonner expéditeur, règle et
consommateur. Relever les compteurs des files et DLQ avant déploiement ; ne pas
purger. Les anciens événements SES sans tag ne doivent pas être attribués
automatiquement à un environnement. S'ils existent, leur réconciliation exige
des preuves fournisseur et un périmètre opérateur explicite.

Le rollback doit également coordonner les trois composants, garder les envois
fermés et analyser les événements en attente. Aucun replay automatique de
messages d'envoi à résultat incertain n'est introduit.

## Publication et contrôles réels

- [PR #42](https://github.com/YoannDrx/yodev-mail/pull/42) fusionnée le 7 septembre
  à 02 h 01 min 09 s (Paris), sans contournement des protections. Tête testée
  `cd91eab2001e1f87af2c45913f7d37d15ea3f667`, commit de fusion
  `eb9160e6b4a11195264d5b293d639087d5e07d5c` ; arbres identiques.
- CI de PR `34068365796` et de `main` `34068484997` entièrement vertes,
  y compris les huit parcours authentifiés (58,8 secondes sur `main`).
- AWS Dev `UPDATE_COMPLETE` à 02 h 02 min 19 s, Prod à 02 h 03 min 46 s.
  Les deux règles restent `DISABLED`. Les 26 workers restent en standby,
  SES/Postmark désactivés ; zéro mapping Lambda/SQS après publication.
- Hash du code `SendEmail` Dev/Prod :
  `ZE9TM+nFVftLC2ho6HbgJvWCPsA8/CC7aLMAnDUW/Uw=` ; `ProviderEvents` :
  `VXw/6NI7JkawM9901p9qqgyXdF83uiQymaddO7GrJu8=`.
- Vercel Production `dpl_BM5dkFpiP1CEmUcpYfmxQ67eCnwF` est `READY` sur le
  commit de fusion ; build environ 34 secondes. Le health API retourne
  `status=ok`, `database=ok`, `version=eb9160e`. Le health de `mail.yodev.fr`
  redirige vers `api.mail.yodev.fr`, et l'onboarding anonyme vers `/fr/connexion`.
  Aucun log Vercel `error`/`fatal` retourné sur la courte fenêtre vérifiée.
- Les quatre files d'événements et DLQ étaient vides avant déploiement
  (visible, en cours, différé), sans lecture ni purge de leur contenu.
- Les 16 cas `TestEventPattern` ont été rejoués sur les **règles déployées** :
  16/16. Les transformateurs déployés comportent le chemin du tag environnement.
- Deux invocations synchrones contrôlées du worker `ProviderEvents`, une par
  environnement : chacune reçoit deux événements synthétiques, l'un du mauvais
  environnement et l'autre sans environnement. Les deux fonctions répondent
  HTTP 200 sans `FunctionError`, avec les deux identifiants dans
  `batchItemFailures` et deux logs `invalid_event` attendus. Le chargement de
  configuration runtime a donc abouti et le refus intervient avant ingestion.
  Quatre rejets vérifiés au total, sans adresse ni contenu d'email, sans
  publication en file ou envoi fournisseur. Les logs d'erreur de contrat créés
  par ce test négatif sont attendus, pas des incidents clients.
  Réponses techniques conservées dans
  `/tmp/yodev-mail-ses-isolation.PznUsL/dev.json` et `prod.json`.

Ces invocations directes ne certifient pas le transport SQS/EventBridge complet,
ni les scénarios acceptés en base. Elles ne remplacent pas les 72 heures
d'observation. Aucun secret ni donnée client n'est modifié.

## Limites encore ouvertes

Inventaire AWS en lecture seule pendant la CI : `ListTenants` dans `eu-west-3`
retourne uniquement `ym-sandbox-cert` (créé le 21 août). Ses ressources sont
`configuration-set/ym-sandbox-cert-txn` et `identity/mail.yodev.fr`.
Aucun tenant nommé d'après un workspace applicatif n'est retourné ; les bindings
DB restent à inventorier pour vérifier les références réelles. Aucun tenant,
configuration set ou domaine n'a été créé, renommé ou modifié par ce lot.

- Certification réelle de toute la chaîne SES : envoi contrôlé, transformation,
  file, ingestion, retours négatifs, comptabilisation et reprise/DLQ.
- Le nom du tenant SES et de sa configuration repose encore sur le workspace,
  pas sur l'environnement. Des workspaces copiés peuvent donc référencer les
  mêmes ressources fournisseur : inventorier les bindings et isoler les
  ressources de certification avant activation. Ce lot ne renomme ni ne migre
  de tenant/identité existant et ne prouve pas leur isolation complète.
- Un tag est un critère de routage, pas une authentification. Les politiques IAM
  et la corrélation DB restent nécessaires ; aucun élargissement IAM ici.
- Approbation AWS, Stripe Live, restauration et observation de 72 heures restent
  des conditions distinctes. Aucun GO commercial déduit de ces tests.

## Sources officielles

- [Tags SES](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageTag.html).
- [Correspondance des tableaux EventBridge](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-patterns-arrays.html).
- [TestEventPattern](https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_TestEventPattern.html).
