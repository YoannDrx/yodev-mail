# Ressources et rattachements SES - 7 septembre 2026

## Inventaire en lecture seule

À 02 h 09 environ (Paris), le projet Neon `round-star-39482619` comporte toujours
dix branches. Les branches `main` (`br-sweet-haze-aso0rivg`) et `development`
(`br-sweet-glade-aswbou1h`) sont prêtes. La seconde a été réinitialisée depuis
`main` le 13 août : un UUID de workspace ne constitue donc pas une frontière
d'environnement.

Une requête explicitement limitée au workspace interne
`15734662-27a7-4bd8-b4bf-e6caed86a17a` ne retourne **aucun** compte SES, binding
SES ni entrée `ses_resources`, dans chacune de ces deux branches. Aucune adresse,
aucun contenu, aucune valeur de credential n'a été sélectionné. Ce résultat est
limité à cet espace ; ce n'est pas un inventaire global de tous les workspaces.

La lecture paginée `ListTenants` dans le compte AWS `274319534967`, région
`eu-west-3`, retourne uniquement `ym-sandbox-cert`. Ce tenant historique n'est
pas renommé ni modifié. Aucun objet SES ni donnée Neon n'est créé dans ce lot.

## Défauts et correction

Le provisionnement produisait `ym-{workspaceId}` et l'expéditeur acceptait
l'identifiant externe stocké sans le comparer au workspace/environnement.
Une copie de base pouvait donc réutiliser le tenant et sa configuration d'un
autre environnement, malgré le filtrage des événements ajouté en PR #42.

- Contrat commun : `ym-{dev|prod}-{UUID}` et configuration `{tenant}-txn`.
  L'UUID est validé, pas tronqué ou transformé à partir d'un texte arbitraire.
- Provisionnement : environnement explicitement valide, compte existant nul
  ou exactement compatible. Un ancien compte, un compte d'un autre environnement
  ou une chaîne vide est refusé avant tout appel SES/STS.
- Expédition : contrôle strict du compte attendu ; rejet définitif
  `ses_account_mismatch` sans envoi ni retry fournisseur pour un mauvais compte.
- Persistance : si le compte change pendant le provisionnement, la transaction
  refuse de l'écraser et annule aussi la mise à jour du binding. Cette protection
  commune couvre SES et Postmark ; le résultat externe reste à réconcilier.

Le worker conserve son code public/technique générique
`provider_provisioning_failed` pour les erreurs de provisionnement. Un opérateur
doit comparer les références stockées avec le contrat attendu ; aucun diagnostic
arbitraire fournisseur n'est enregistré.

## Vérification et déploiement

Avant correctif, 14 assertions échouaient : noms communs, environnement invalide
accepté, mauvais comptes transmis à SES. Après correctif, 46 tests unitaires
ciblés et 26 tests PostgreSQL de provisionnement passent. Le lot ajoute
18 cas unitaires et trois scénarios PostgreSQL aux suites existantes.

- `npm run check` vert : lint, TypeScript, 239 tests unitaires et build.
- Couverture complète : 353 tests / 46 fichiers, 79,75 % des lignes,
  72,76 % des branches, seuils inchangés. Base PostgreSQL locale synthétique.
- Huit parcours publics Playwright verts en 22,5 secondes. `agent-browser`
  absent, sans contrôle visuel supplémentaire ni installation implicite.
- Diff CDK : uniquement les assets de code `SendEmail` et
  `ProviderProvisioning`, dans chaque environnement ; pas de remplacement,
  IAM, stockage, secret, schéma ou fondation modifié.

Publication coordonnée des workers d'envoi et de provisionnement en standby.
Aucune migration de schéma ; aucun remplacement automatique de binding. Les
références historiques, si elles existent dans d'autres espaces, restent fermées
et nécessitent une réconciliation explicite. Les gates commerciaux ne changent
pas.

### Publication vérifiée

- [PR #43](https://github.com/YoannDrx/yodev-mail/pull/43) fusionnée le 7 septembre
  à 02 h 21 min 07 s (Paris), sans contournement des contrôles. Tête testée
  `c34c66df63bf42bf740e1fd7c8d5207f69ca8a33`, commit publié
  `7436dd392d13ec138ed730be94f12b872e8b5c04`, arbres identiques.
- CI PR `34069402476` et `main` `34069542657` vertes. Les huit parcours
  authentifiés passent sur `main` en 59 secondes ; les huit publics en 17,9 s.
- AWS Dev `UPDATE_COMPLETE` à 02 h 21 min 53 s ; Prod à 02 h 22 min 48 s.
  Hash `SendEmail` commun : `iAOTJihITeP2klbF0BnkCIDxjxO2J+KUqj890P6FSKo=`.
  Hash `ProviderProvisioning` : `At8oy8jal99Xa5fK0Vkv+LVH6DQA5R3jnEI3Q5LKIcM=`.
  Les 26 workers sont en `OPERATING_MODE=standby`, avec les deux fournisseurs
  désactivés. Zéro mapping Lambda/SQS ; les deux règles SES restent désactivées.
- Vercel Production `dpl_EhGbbqXtRHHTnxLUcNNd6PXdnhRo` est `READY` sur le commit
  publié (build 32,2 s). Le health API répond `ok`, base `ok`, version
  `7436dd3` ; l'onboarding anonyme redirige vers `/fr/connexion`.
  Aucun log `error`/`fatal` retourné sur la courte fenêtre post-publication
  vérifiée, sans prétendre à une observation de 72 heures.
- Lecture SES pendant la CI : accès production toujours `false`, revue
  `DENIED`, quota sandbox 200/jour et 1/seconde, zéro envoi sur 24 h.
  `mail.yodev.fr` est vérifié, DKIM et MAIL FROM `SUCCESS`, comportement
  `REJECT_MESSAGE` si le MX MAIL FROM est invalide. Aucun email envoyé par ce lot.

## Limites

Cette isolation applicative des noms ne constitue pas une isolation IAM complète
des deux environnements : les permissions SES existantes restent inchangées.
Les identités SES sont définies par domaine et peuvent être associées à plusieurs
tenants. Les essais doivent utiliser un espace synthétique dédié et un domaine
contrôlé, avec ses associations vérifiées ; ne pas modifier implicitement une
identité partagée. Aucun parcours d'envoi réel ni transformation EventBridge
n'est certifié par ces mocks et tests PostgreSQL.

L'approbation de production AWS, la facturation Live, la restauration et les
72 heures d'observation restent des conditions distinctes du GO commercial.

## Sources

- [Gestion et partage des ressources des tenants SES](https://docs.aws.amazon.com/ses/latest/dg/tenants.html).
- [Contraintes des noms de tenants SES](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-ses-tenant.html).
- [Restrictions IAM par tenant](https://aws.amazon.com/blogs/messaging-and-targeting/improve-email-deliverability-with-tenant-management-in-amazon-ses/).
