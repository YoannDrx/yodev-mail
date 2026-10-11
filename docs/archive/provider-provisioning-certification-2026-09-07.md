# Provisioning fournisseur - certification du 7 septembre 2026

## Périmètre et résultat

Ce lot renforce le worker SES/Postmark, la demande de provisioning de
l'administration et le contrôle DNS associé. Il ne certifie pas encore toute la
création des ressources Postmark ni la chaîne complète d'envoi SES. Le statut
commercial reste **NO-GO** et les gates restent fermées.

Corrections réalisées :

- Contrat de job strict `{ workspaceId, bindingId }`, avec UUID valides et refus
  des champs supplémentaires. Le producteur, le consommateur et le chemin local
  transmettent tous le workspace. Aucun email ni contenu dans ce job.
- Lecture et écritures du worker limitées au workspace ; refus des jobs
  inter-workspaces avant accès fournisseur.
- Un job obsolète ne redescend plus un binding vérifié ou en attente DNS à un
  état antérieur ; il ne réactive pas un binding ou compte désactivé/suspendu.
- Les écritures après l'appel fournisseur réévaluent le workspace, le domaine,
  le binding et la suspension du compte. La mise à jour binding/compte est
  atomique ; une suspension observée lors de l'upsert annule la transaction.
- Les erreurs fournisseur deviennent le code fixe
  `provider_provisioning_failed`, sans texte brut stocké ou propagé.
- L'action admin n'utilise plus une nouvelle demande de provisioning pour
  réinitialiser implicitement un binding déjà provisionné ou désactivé.
- Un binding sans identité externe n'est plus vérifié prématurément par le
  contrôle DNS, direct ou planifié.

Les appels fournisseur déjà engagés ne peuvent pas être annulés rétroactivement
par ces gardes SQL. Une ressource externe créée pendant une suspension peut
nécessiter une réconciliation ; aucune suppression automatique n'est ajoutée.

## Tests et preuves locales

Deux défauts du worker ont été reproduits avant correction : propagation du
texte brut d'erreur et réactivation d'un binding désactivé pendant l'appel.
Le test de vérification DNS prématurée a également échoué avant correction.

- 17 tests PostgreSQL du worker : SES/Postmark simulés, reprise, isolation,
  suspensions avant/pendant l'appel, succès/erreur tardifs et batch SQS partiel.
- 7 tests PostgreSQL du contrôle de domaines, dont la nouvelle protection avant
  disponibilité de l'identité externe.
- 6 tests PostgreSQL de l'action admin : transmission du workspace, états
  protégés, reprise d'un échec et refus d'un domaine désactivé.
- 6 tests unitaires du contrat et 3 nouveaux tests du producteur SQS.
- Le test préexistant d'absence de retry SDK sur un envoi SES incertain reste
  présent ; il n'a pas été remplacé par les tests du producteur.
- `npm run check` local réussit : lint, TypeScript, 167 tests et build Next.js.
- `npm run test:coverage:full` local réussit : 255 tests dans 42 fichiers,
  76,56 % des lignes et 67,26 % des branches. L'import nouvellement testé des
  actions admin élargit le périmètre mesuré ; leur fichier reste peu couvert
  globalement (11,17 % des lignes). Cette mesure ne doit pas être présentée
  comme une amélioration du pourcentage global précédent.

Les tests utilisent PostgreSQL 17 local et des fournisseurs simulés ; ils ne
créent aucune ressource SES/Postmark réelle et n'envoient aucun email. La suite
complète et les parcours navigateur CI doivent passer avant publication.

## Préconditions de bascule du contrat SQS

L'ancien job ne contenait que `bindingId`. Il est délibérément rejeté, sans
déduction implicite du workspace. Ne pas publier ce changement avec des jobs
anciens en attente ou des consommateurs actifs.

Contrôles en lecture effectués le 7 septembre vers 00:28 heure de Paris :

- Compte AWS `274319534967`, région `eu-west-3`, rôle SSO administrateur YoDevMail
  non-root ; 26 workers Dev/Prod en `standby`, SES et Postmark à `false`.
- Aucun mapping SQS Lambda dans cette région.
- Files `yodev-mail-{dev,prod}-provider-provisioning` et leurs DLQ : zéro message
  visible, invisible ou différé selon les compteurs approximatifs SQS.
- Branche Neon principale `br-sweet-haze-aso0rivg`, workspace interne explicite
  `15734662-27a7-4bd8-b4bf-e6caed86a17a` : un binding Postmark vérifié/actif avec
  identité externe ; compte Postmark prêt avec référence de credential présente.
  Aucun secret ni contenu email lu. Aucun binding SES sur ce workspace.

Publier le producteur web et les assets workers sous gates fermées ; revérifier
ces préconditions avant leur future activation. Si des jobs anciens apparaissent,
interrompre la bascule et les réconcilier explicitement, sans purge automatique.
Le rollback doit conserver les gates fermées et des files vides : ne pas mixer
un producteur ancien et un consommateur strict actif.

Le `cdk diff` Dev/Prod avec changesets de lecture est examiné : seuls les assets
de code des 13 Lambdas par environnement changent, du fait du module AWS partagé.
Aucune permission, variable d'environnement, file, clé ou ressource de stockage
ne change ; aucun remplacement. La fondation n'est pas incluse dans ce lot.

## Provisioning Postmark : travaux encore ouverts

Mise à jour : les sept constats ci-dessous sont traités techniquement dans le
[lot de reprise Postmark du 7 septembre](postmark-recovery-certification-2026-09-07.md).
Cette liste conserve le constat au moment de la publication #38 ; les preuves
de tests, limites de réconciliation et étapes fournisseur réelles sont dans le
nouveau compte rendu. Elle ne doit plus être lue comme l'état du code courant.

L'inspection de `provision-postmark.ts` identifie une suite distincte à corriger
et certifier avant ouverture :

1. La recherche de serveur utilise le nom mutable du workspace ; utiliser une
   identité opaque stable, sans adopter le serveur d'un autre workspace portant
   le même nom.
2. Paginer les listes de serveurs/domaines au-delà des 500 premiers résultats.
3. Rendre la reprise après échec partiel sûre : ne pas régénérer/écraser le mot
   de passe webhook puis conserver un webhook existant avec l'ancien accès.
4. Réconcilier les paramètres/authentification d'un webhook existant et traiter
   un échec de listing comme une erreur, pas comme une liste vide.
5. Certifier la vérification du webhook lors de sa création. La documentation
   Postmark expose `Verify=true` par défaut, alors que le compte applicatif est
   actuellement enregistré seulement après le retour du provisioning. Une
   initialisation durable par étapes doit rendre l'authentification du callback
   possible avant sa vérification.
6. Sérialiser les créations concurrentes d'un même compte fournisseur et gérer
   les ressources créées avant une interruption. Les gardes finales de ce lot
   ne constituent pas un verrou de création externe.
7. Borner le budget total des appels de provisioning à l'échéance Lambda ; les
   timeouts individuels ne suffisent pas à garantir ce budget.

Références officielles consultées : [webhooks Postmark](https://postmarkapp.com/developer/api/webhooks-api),
[serveurs](https://postmarkapp.com/developer/api/servers-api),
[domaines](https://postmarkapp.com/developer/api/domains-api) et
[traitement des erreurs SQS/Lambda](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).

Ces constats ne signifient pas que le webhook Postmark existant a cessé de
fonctionner ; son état réel de vérification reste à relire. Aucun secret ni
webhook fournisseur n'est modifié dans ce lot.

## Publication et contrôle post-déploiement

La [PR #38](https://github.com/YoannDrx/yodev-mail/pull/38) est fusionnée à
00:32:11 heure de Paris (6 septembre, 22:32:11 UTC), commit
`86cb30af56bf78edbc2522acda3239ac12eef273`. Les six contrôles obligatoires de
branche ont passé, sans contournement ni modification de protection.

- [CI de PR](https://github.com/YoannDrx/yodev-mail/actions/runs/34064173358) : tous
  les jobs verts ; huit parcours publics (18,6 s) et huit authentifiés (1,1 min).
- [CI de main](https://github.com/YoannDrx/yodev-mail/actions/runs/34064303135) :
  tous les jobs verts, dont les parcours authentifiés et la couverture complète.
- Vercel Production `dpl_3XW9M1GzxHyH3X8H7oGWP91CWGnd` : `READY`, URL technique
  `https://yodev-mail-l72ngmemo-yoanndrxs-projects.vercel.app`.
- API health : `status=ok`, `database=ok`, `version=86cb30a`. Le health de
  l'application redirige vers ce même endpoint canonique, qui répond aussi après
  suivi. L'onboarding anonyme redirige en 307 vers `/fr/connexion`.
- Scan `error`/`fatal` explicitement limité à ce déploiement Vercel : zéro entrée,
  effectué après publication. Fenêtre courte, sans charge : ce n'est pas la
  période d'observation de 72 heures.
- AWS Dev `UPDATE_COMPLETE` à 22:33:21 UTC ; AWS Prod à 22:34:34 UTC. Les 26
  workers ont leur code mis à jour et restent en `standby`, SES/Postmark faux.
  Aucun mapping SQS ; files de provisioning et DLQ toujours vides au contrôle.
- Worker de provisioning Prod : `Active`, dernière mise à jour `Successful`,
  code SHA256 `fgLH116iKJ0P0FqFL5Xm7Mt69EmIoD9TacRrhVSnuxI=`.
- SES relu dans `eu-west-3` : production false, review `DENIED`, sandbox
  200/jour et 1/s ; identité `mail.yodev.fr` vérifiée, DKIM RSA 2048 et MAIL FROM
  `bounce.mail.yodev.fr` en succès. L'absence d'accès production reste bloquante.

Les ajouts de cette section sont un compte rendu local après publication, à
committer avec le lot suivant. Ils ne déclenchent pas une publication séparée.
