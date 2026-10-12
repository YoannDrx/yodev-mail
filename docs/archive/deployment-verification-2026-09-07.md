# Vérification de publication - 7 septembre 2026

## Lot authentification publié

La [PR #37](https://github.com/YoannDrx/yodev-mail/pull/37) est fusionnée le
7 septembre à 00:01:47 heure de Paris (6 septembre à 22:01:47 UTC), sans
contournement des contrôles obligatoires. Commit de production :
`85e2ae8b0262089027edbedfd224df9f3c8cc959`.

Correction publiée : un utilisateur connecté sans workspace accessible ne tombe
plus sur une erreur serveur après un retrait de membre ou avant l'acceptation de
son invitation. Il voit un état explicatif, avec changement de workspace et
déconnexion. Les erreurs techniques de base de données ne sont pas masquées par
cette récupération. L'onboarding anonyme exige désormais explicitement la session.

## Preuves automatiques

- [CI initiale du code](https://github.com/YoannDrx/yodev-mail/actions/runs/34062395514) : réussie.
- [CI de la tête finale de PR](https://github.com/YoannDrx/yodev-mail/actions/runs/34062603833) : réussie.
- [CI du commit fusionné](https://github.com/YoannDrx/yodev-mail/actions/runs/34062794264) : tous les jobs réussis.
- `npm run check` en CI : lint, TypeScript, 158 tests unitaires/infrastructure et build.
- Suite complète avec PostgreSQL : 222 tests ; couverture mesurée 83,92 % des
  lignes et 71,38 % des branches dans la CI initiale.
- Huit parcours publics et huit parcours authentifiés. Les parcours authentifiés
  de la tête finale passent en 59,4 secondes, sans retry signalé.
- Le contrôle `authenticated-e2e` est obligatoire sur `main`, lié à GitHub Actions.
  Les cinq contrôles précédents, leurs applications et le mode strict restent
  présents.

Les [scénarios et limites de certification](authenticated-certification-2026-09-06.md)
sont détaillés séparément. Tous les comptes, mots de passe et données de cette
suite sont synthétiques et restent dans une base locale dédiée ou PostgreSQL CI.

## Vérification Vercel

- Projet : `prj_JCc2ILIb7pbLbGIjVPg2KeLaC38t`, équipe `team_3XXL1abz5SsLVR9IW9gUU0Sv`.
- Déploiement : `dpl_DPCPNoUwVzC3dR6dKFtEURvsPbFc`, cible `production`, état `READY`.
- URL technique : `https://yodev-mail-g1jqffu6z-yoanndrxs-projects.vercel.app`.
- `https://api.mail.yodev.fr/health` répond `status=ok`, `database=ok`, `version=85e2ae8`.
- `https://mail.yodev.fr/health` redirige en 308 vers ce contrôle canonique ; le
  suivi de la redirection retourne le même résultat, et non un second contrôle
  indépendant de base de données.
- L'onboarding anonyme de production redirige en 307 vers `/fr/connexion`, dont
  le titre de connexion attendu est présent.
- Le scan des logs `error`/`fatal`, limité explicitement à ce déploiement et
  effectué à plus d'une minute de sa publication, ne retourne aucune entrée.
  Cette fenêtre courte et peu chargée ne constitue pas une validation sous charge
  ni la surveillance de 72 heures requise avant ouverture commerciale.

## Résultats locaux conservés sans les embellir

Les 13 tests unitaires ciblés et le lint ciblé passent. Le premier passage des
parcours a révélé le défaut de récupération et une attente d'hydratation manquante
dans le test de passkey ; ils ont été corrigés puis rejoués.

La dernière suite locale complète a terminé avec sept succès et un timeout global
de 120 secondes lors d'une lecture API, sur une machine fortement chargée. Ce
scénario avait passé précédemment et passe dans les CI du même code. Aucun test
ni assertion n'a été supprimé pour obtenir la validation CI.

Une relance locale de `npm run check` a terminé le lint puis est restée plus de
sept minutes dans TypeScript. Seul ce processus et ses enfants, dont le répertoire
avait été vérifié, ont été arrêtés pour libérer les ressources. Le build et les
tests de cette dernière relance locale n'ont donc pas été exécutés. Ils sont
validés par les trois CI mentionnées ci-dessus. Aucun autre projet/processus n'a
été interrompu.

## Conditions d'ouverture inchangées

Aucune migration ni donnée de production modifiée, aucune infrastructure AWS
redéployée dans ce lot, aucun email client, aucun paiement et aucune gate activée.
L'objectif global reste en cours et le statut commercial reste **NO-GO** :

- approbation SES production et certification de la chaîne applicative complète ;
- durcissement du worker de provisioning fournisseur encore à traiter : passage
  explicite du workspace, préservation des bindings désactivés et remplacement de
  la persistance du texte brut d'erreur fournisseur par un code technique sûr ;
- activation Stripe par le propriétaire, régime TVA confirmé, catalogue/webhooks
  et cycle de facturation dédiés certifiés ;
- restauration Neon isolée, alertes du workload, reprise/DLQ et canaris contrôlés ;
- Google OAuth réel, emails d'authentification et passkeys physiques/multinavigateurs ;
- pièces jointes à certifier si incluses, sinon à conserver désactivées.

Ce compte rendu est un artefact local de clôture du déploiement, rédigé après la
fusion. Il ne déclenche pas de nouvelle publication documentaire à lui seul.
