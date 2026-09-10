# Certification des permissions SES - 7 septembre 2026

Statut : **correctif proposé, non déployé, certification réelle non acquise**.
À l'audit initial, la version publiée est `7436dd3` (PR #43). Les stacks Dev et Prod restent en
standby. Ce rapport ne vaut pas GO commercial.

## Défaut vérifié

Le rôle déployé `YodevMailDev-SendEmailServiceRoleD565FAA3-zts9xOfKV08D`
autorise `ses:SendEmail` sur `*`, sans condition de tenant. Une simulation AWS
sur ce rôle, avec le contexte d'un tenant `ym-prod-{UUID}`, une identité du
compte et une configuration Prod, retourne `allowed`. Les références de tenant
et de configuration de cet essai sont synthétiques. Aucun message n'est envoyé
et aucun accès inter-environnement réel antérieur n'est établi par ce constat.

Le provisioner dispose aussi de permissions SES d'écriture sur `*`. L'isolation
applicative et le filtrage EventBridge des PR #42/#43 ne remplacent pas une
frontière IAM.

## Correctif proposé

- Expéditeur : `ses:SendEmail` limité au compte/région, au préfixe de tenant
  de son environnement et aux configurations `ym-{dev|prod}-*-txn`.
  L'identité doit porter `yodev:environment=dev|prod` correspondant au rôle.
- Provisioner : tenants/configurations limités par préfixe ; associations et
  modification MAIL FROM conditionnées à la propriété de l'identité ; seule la
  politique de réputation `standard` peut être affectée.
- Création d'identité : tag d'environnement obligatoire. Le code vérifie le tag
  retourné avant de créer le tenant/configuration ou de modifier le MAIL FROM.
  Une identité déjà existante, non attribuée ou attribuée à l'autre environnement,
  n'est ni retaguée ni adoptée automatiquement par le code applicatif.
- Lecture `GetEmailIdentity` autorisée dans le compte/région. Pas d'autorisation
  `SendRawEmail`, `SendBulkEmail`, de suppression SES ou de changement de secrets.

Limite importante : `TagResource`, nécessaire à la création taguée, permet
également d'attribuer **par appel AWS direct** une identité existante non taguée.
La condition refuse le remplacement d'un tag de l'autre environnement, mais ne
distingue pas une ressource nouvelle d'une ressource historique non attribuée.
Le contrôle applicatif n'est donc pas une preuve d'impossibilité IAM d'adopter
une identité historique. Inventorier et attribuer explicitement les identités
utilisées avant toute activation. L'IAM proposé sépare les environnements, pas
chaque workspace à l'intérieur d'un environnement ; ces rôles restent des rôles
de plateforme, inaccessibles aux clients.

`mail.yodev.fr`, identité vérifiée avec DKIM et MAIL FROM `SUCCESS`, ne porte
actuellement aucun tag `yodev:environment`. Elle reste intacte. Son association
au tenant historique `ym-sandbox-cert` n'est pas modifiée.

## Vérifications réalisées

- Sept assertions en échec avant correction ; 43 tests ciblés passent après.
- `npm run check` : lint, types, 245 tests unitaires/infrastructure et build
  réussis. La vérification du script IAM est exécutée séparément après son ajout.
- `TEST_DATABASE_URL=<PostgreSQL local synthétique> npm run test:coverage:full` :
  359 tests, 46 fichiers ; 79,91 % des lignes, 73 % des branches. Seuils inchangés.
- Huit parcours publics Playwright réussis en 7,3 secondes. `agent-browser`
  absent ; pas de contrôle visuel supplémentaire ni de nouvelle certification
  Google OAuth, email d'authentification ou passkey physique par cet essai.
- `eslint` ciblé sur le script IAM et la stack, `node --check` sur le script et
  `git diff --check` réussis après ajout du script.
- Diff CDK contre AWS : deux politiques IAM et les assets SendEmail/
  ProviderProvisioning par stack ; aucun changement de stockage, schéma,
  fondation ou gate, aucun remplacement de ressource métier.
- `accessanalyzer validate-policy` sur les quatre politiques SES proposées :
  zéro constat retourné. Ce contrôle statique ne prouve pas les autorisations
  réellement exercées par SES.
- Matrice `scripts/verify-ses-iam.mjs`, source `assembly` : 76 scénarios, 70
  résultats attendus et **six échecs**, code de sortie 1 conservé. Dans chaque
  environnement, les cas positifs SendEmail, CreateConfigurationSet et
  CreateEmailIdentity sont refusés. Aucun échec n'est neutralisé ou converti en
  succès pour permettre le déploiement.

Commande en lecture seule, à partir d'un `cdk.out` synthétisé pour le compte et
la région attendus :

```sh
node scripts/verify-ses-iam.mjs --source assembly --profile yodev-mail-admin --account 274319534967 --region eu-west-3
```

`--source deployed` utilise les rôles effectivement attachés aux quatre workers.
Ne pas l'interpréter comme une certification de ressources réelles : les ARN et
tags des cas sont des entrées synthétiques. Le script ne crée pas de ressource,
n'envoie pas de message, n'assume pas les rôles et ne lit pas de secret.

## Divergence du simulateur, non résolue

### État de la revue

[PR #44](https://github.com/YoannDrx/yodev-mail/pull/44), **brouillon**,
tête `0f1d9bf93c6802ffa18fa5e975983b56c1f808d5`.
[CI 34070938308](https://github.com/YoannDrx/yodev-mail/actions/runs/34070938308)
entièrement verte, contrôles requis compris : qualité, intégration, parcours
publics et authentifiés, secrets et aperçu Vercel. Les simulations IAM réelles
ne font pas partie de cette CI ; leurs six échecs restent ouverts.

Relecture après création du brouillon : 26 workers en standby, 26 avec
`SES_ENABLED=false` et `POSTMARK_ENABLED=false`. API health `ok`, base `ok`,
version `7436dd3`. SES : production `false`, revue `DENIED`, quota 200/jour et
1/seconde, zéro envoi sur 24 heures. Aucune fusion ou publication en production.
Ces preuves post-CI sont ajoutées au rapport local après le commit du brouillon.

### Cas témoins

Cas témoins exécutés : SendEmail sur une identité explicite est autorisé avec
une politique inconditionnelle. La même action sous condition `ses:TenantName`,
avec la valeur correspondante fournie au simulateur, est autorisée lorsque
`ResourceArns` est omis mais refusée lorsque l'ARN de l'identité est fourni.
Le résultat ne signale pas de contexte manquant. Des conditions témoins
`aws:username` et `aws:ResourceTag/yodev:environment` fonctionnent avec cet ARN.

La référence SES v2 documente `ses:TenantName` pour SendEmail et les ressources
employées. Cela ne suffit pas à qualifier la divergence de bug AWS confirmé,
ni à garantir que la politique proposée fonctionnera à l'exécution. Le simulateur
AWS documente lui-même des différences possibles avec les appels réels.

## Conditions de reprise

**Mise à jour du 10 septembre** : le compte de test `764858776290` existe,
son accès et sa journalisation sont vérifiés. Une sonde privée à quatre rôles
réutilise les politiques candidates ; 44 appels réels de provisioning ont les
résultats attendus. SendEmail reste non testé en attente de validation DNS, le
Mac étant verrouillé lors de l'accès OVH. Voir le
[rapport de certification réelle](ses-real-probe-2026-09-10.md).
La production web est désormais `c5b91e4` (correctif de sécurité #47 uniquement).
La PR #44 reste non fusionnée et les permissions applicatives AWS inchangées.
Les conditions ci-dessous sont celles du diagnostic initial et ne constituent
pas un inventaire actuel des comptes.

1. Identifier un compte AWS de test distinct de celui qui héberge la production.
   La procédure du skill `aws-cdk` interdit les essais d'intégration dans le
   compte de production. `Organizations ListAccounts` ne retourne que le compte
   `274319534967`, actif ; les profils locaux sont `default` et
   `yodev-mail-admin`. Cela n'exclut pas un compte indépendant non connecté.
   Aucune sonde Lambda ni nouveau compte n'est créé.
2. Dans ce périmètre, déployer une sonde privée et temporaire contenant exactement
   les seules permissions SES proposées, sans DB, secrets, files, URL publique
   ou déclencheur automatique. Vérifier séparément les cas positifs et négatifs
   par les API SES v2 ; utiliser uniquement des identités de test contrôlées et
   le mailbox simulator pour les envois. Un rejet d'identité non vérifiée ne
   vaut pas preuve de livraison.
3. Résoudre toute divergence avant fusion/déploiement du correctif. Exécuter les
   contrôles requis, puis déployer en standby et relire politiques et gates.
4. Réconcilier explicitement les identités historiques, puis certifier séparément
   DNS, envoi, retours EventBridge/SQS, ingestion et ledger applicatif. La sonde
   IAM ne certifie pas cette chaîne complète.

AWS SES demeure en sandbox avec accès production refusé lors de la dernière
lecture. L'approbation AWS, Stripe Live/TVA, la restauration Neon et les canaris
contrôlés restent des dépendances distinctes. Ne pas élargir les permissions,
changer de région pour contourner le refus ou ouvrir les gates pour accélérer
les tests.

## Sources officielles

- [Actions, ressources et conditions SES v2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html).
- [Exemple AWS de condition IAM par tenant](https://aws.amazon.com/blogs/messaging-and-targeting/improve-email-deliverability-with-tenant-management-in-amazon-ses/).
- [Limites du simulateur IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_testing-policies.html).
- [CreateEmailIdentity et tags](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateEmailIdentity.html).
