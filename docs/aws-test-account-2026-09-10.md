# Compte AWS de test YoDevMail - 10 septembre 2026

Statut : compte créé, accès SSO et réception de l'adresse administrative
vérifiés. Ce jalon ne certifie ni les permissions SES proposées, ni les envois
SES de l'application, ni le GO commercial.

## Périmètre créé

| Élément | Valeur vérifiée |
| --- | --- |
| Organisation existante | `o-cc8vhcvy4t` |
| Compte de gestion et workloads existants | `274319534967`, inchangé |
| Nouveau compte | `764858776290` |
| Nom | `YoDevMail - Test` |
| État Organizations | `ACTIVE` |
| Adresse du compte | `aws-yodevmail-test@yodev.fr` |
| Région des contrôles SES | `eu-west-3` |
| Profil CLI local ajouté | `yodev-mail-test` |
| Permission set SSO | `YoDevMailAdministrator` |

Création autorisée par le propriétaire, effectuée via Organizations avec le
profil SSO `yodev-mail-admin`. Requête
`car-614bbacd225e4a8ab3aa20e4f8254e8f`, état final `SUCCEEDED`.
L'utilisateur SSO existant du propriétaire a été affecté uniquement au nouveau
compte. Affectation `9598ca3d-ffb5-42d9-a833-1c2fd78fc0d8`, état final
`SUCCEEDED`. STS retourne bien `Account=764858776290` avec le nouveau profil.

Le compte reste membre de l'organisation et sa facturation y est consolidée.
Le rôle standard `OrganizationAccountAccessRole` a été demandé à la création.
Les politiques héritées de la racine sont `FullAWSAccess` et
`DenyLeaveAndCloseAccount` ; cette dernière interdit la sortie de l'organisation
et `account:CloseAccount`. Aucun nouveau garde-fou global n'a été imposé aux
workloads existants.

## Adresse administrative

OVH : une redirection a été ajoutée à l'offre `redirect` existante de `yodev.fr` :
`aws-yodevmail-test@yodev.fr` vers la boîte Gmail habituelle du propriétaire.
La ligne exacte est présente dans la liste OVH après validation. Aucune boîte
payante, modification DNS ou modification des redirections existantes.

**Réception confirmée lors de la reprise du 10 septembre** : Gmail contient le
message « Your Amazon Web Services Account is Ready - Get Started Now », reçu
le 10 septembre 2026 à 13 h 22, de `no-reply@amazonaws.com`, destiné à
`aws-yodevmail-test@yodev.fr`. Les détails Gmail indiquent « envoyé par
yodev.fr », « signé par amazonaws.com » et TLS. Libellés présents : Boîte de
réception, Notifications et Apps/Yodev. Ce message externe confirme la réception
par la nouvelle redirection, sans avoir besoin d'envoyer le test à soi-même.

Le contrôle précédent du navigateur s'était interrompu avant l'envoi du message
technique préparé dans Gmail ; un brouillon de vérification peut rester présent.
Le connecteur Gmail demande toujours une réauthentification ; la preuve a été
lue dans le navigateur connecté. Aucun filtre ou libellé n'a été modifié.

## Références locales des comptes

`.env.local` contient désormais le répertoire administratif des comptes,
documenté dans `.env.example` et conservé par `npm run env:normalize` :
organisation, portail/session/rôle/utilisateur SSO, noms/IDs/emails/profils et
régions des comptes de gestion et de test. Les IDs Dev et Prod sont explicitement
ceux du compte de gestion existant, pas des comptes supplémentaires.

Ces variables sont des références d'opérateur ; elles ne redirigent pas les
déploiements. `AWS_PROFILE=yodev-mail-admin`, `AWS_ACCOUNT_ID=274319534967`, les
ressources runtime et les gates existants restent inchangés. Aucune clé d'accès,
session temporaire ou mot de passe n'est ajouté au fichier. Aucun `.env`
concurrent ni changement Vercel n'a été créé.

Contrôles après ajout : `env:normalize` ne supprime aucune clé ; comparaison
des empreintes avant/après, toutes les valeurs préexistantes sont conservées.
Le fichier local reste ignoré par Git, avec permissions `0600`. Chargement réel
par `dotenv-cli`, puis STS pour chaque profil : les deux comptes correspondent
aux IDs documentés. Aucune nouvelle publication ni suite applicative complète
n'a été lancée pour cet ajout de métadonnées.

## Budget de suivi

Budget `yodev-mail-test-monthly` créé dans le compte de gestion, région
`us-east-1`, filtré sur `LinkedAccount=764858776290` :

- Budget mensuel : `5 USD`.
- Alertes lorsque le réel dépasse `1 USD` ou `5 USD`.
- Alerte lorsque la prévision dépasse `5 USD`.
- Destinataire : boîte Gmail habituelle du propriétaire, directement, sans
  dépendre de la nouvelle redirection.
- Crédits et remboursements exclus pour ne pas masquer la consommation.
- Relecture : budget `HEALTHY`, filtres et notifications conformes.

Ce budget est une alerte, **pas un plafond ni une estimation de consommation**.
Les budgets préexistants n'ont pas été modifiés. Le budget et l'affectation SSO
sont des opérations d'amorçage via API ; aucune stack applicative ou fondation
de production n'a été redéployée. Leur reprise éventuelle en IaC doit importer
les ressources existantes, pas les recréer à l'aveugle.

## Constat initial à la création du compte

Les points ci-dessous décrivent l'amorçage, avant la journalisation et la
vérification MFA détaillées dans la section suivante.

- Aucun mot de passe root ni clé d'accès permanente créé.
- `GetAccountSummary` : aucune clé root et aucun utilisateur IAM ; indicateur
  MFA du compte à `0`. La protection MFA de la session Identity Center n'a pas
  été recertifiée par ce contrôle. Ne pas assimiler accès SSO à audit MFA complet.
- La gestion centralisée des identifiants root n'est pas activée dans
  l'organisation (`ListOrganizationsFeatures` : trusted access IAM non activé).
  Aucun changement global effectué ; décider de cette protection avant de
  qualifier le nouveau compte de durci.
- Aucun trail CloudTrail, y compris d'organisation, retourné par
  `DescribeTrails` en `eu-west-3`. Prévoir une journalisation durable adaptée
  avant le déploiement des sondes ; ce résultat ne signifie pas que l'historique
  standard des événements CloudTrail est absent.
- Pas de migration de production, de sonde Lambda, d'identité SES, de nouvelle
  demande d'accès production ou d'envoi SES effectué pendant cet amorçage.

## Journalisation déployée lors de la reprise

Le 10 septembre, `CDKToolkit` puis `YodevMailTestAudit` ont été créés dans le
compte `764858776290`, région `eu-west-3`, avec protection contre la suppression
des stacks. Aucun autre compte n'est approuvé dans le bootstrap pour le
déploiement ou le lookup. Le rôle d'exécution CloudFormation utilise la politique
administrateur standard CDK dans ce compte de test uniquement ; ce n'est pas une
certification de moindre privilège de l'outil de déploiement.

La nouvelle application CDK `infra/test-account-app.ts` est séparée de l'entrée
Dev/Prod et refuse un compte ou une région différents. Elle ne charge pas
`.env.local`. La stack déployée contient une clé KMS avec rotation, un bucket
privé chiffré/versionné, un log group chiffré et un trail de gestion multirégion
avec validation des fichiers, conservation d'un an et rétention des ressources
sur suppression/remplacement. Aucun événement de données email ou pièce jointe.

Trail : `yodev-mail-test-management`. Bucket :
`yodevmailtestaudit-auditlogsb945e340-5wgyptnnbhux`. Log group :
`/aws/cloudtrail/yodev-mail-test-management`.

Contrôles AWS : stack `CREATE_COMPLETE`, protection active, blocage public S3
complet, chiffrement KMS et rotation confirmée, `IsLogging=true`, livraison S3 à 13:50:55 et CloudWatch
à 13:52:24, aucune erreur de livraison retournée. Détection de dérive terminée :
`IN_SYNC`, aucune ressource dérivée. Les journaux opérationnels n'ont pas été
affichés ; les contrôles utilisent les métadonnées de livraison.

MFA SSO : le portail de sécurité montre une méthode WebAuthn enregistrée le
18 août. La présence de ce dispositif est confirmée ; la politique d'obligation
MFA à chaque connexion n'a pas été modifiée. `GetAccountSummary` confirme aussi
`AccountPasswordPresent=0`, `AccountAccessKeysPresent=0` et
`AccountSigningCertificatesPresent=0` dans le compte de test. La centralisation
des accès root de l'organisation n'a pas été activée.

Contrôles locaux avant déploiement : `npm run check` (248 tests, lint, types,
build), huit parcours publics, synthèse stricte, relecture du diff. `cdk-nag`
3.0.2 est exécuté explicitement par `validateScope` : zéro violation non reconnue.
Un test négatif vérifie qu'un bucket non protégé échoue réellement au contrôle.
Le plugin seul produisait un rapport vide avec cette version CDK, d'où ce contrôle
explicite bloquant ajouté à la CI. L'exception S1 documentée concerne uniquement
l'absence d'un deuxième puits de logs d'accès S3 pour le bucket CloudTrail.

La suite a d'abord été repriorisée après découverte de nouveaux avis npm,
traités séparément par la PR #47 depuis `main`, sans les changements IAM #44.
Le correctif Next.js 16.3.4 est publié en production sous `c5b91e4` ; les endpoints
`mail.yodev.fr/api/health` et `api.mail.yodev.fr/health` retournent `ok`, base `ok`,
avec ce SHA. La CI de PR et celle de `main` sont vertes. Aucun gate ouvert.

La stack de rôles privés `YodevMailSesProbe` est ensuite créée à 14:06 dans le
seul compte de test. Les 44 contrôles réels de provisioning passent. Les dix
entrées DNS sont ajoutées et vérifiées sur les deux serveurs autoritatifs OVH ;
AWS confirme ensuite les deux identités, DKIM et MAIL FROM `SUCCESS`. Après
diagnostic d'un refus réel lié à ResourceTag sur SendEmail, les deux politiques
sender sont corrigées : tenant IAM obligatoire et contrôle d'association SES,
propriété toujours imposée aux écritures d'association. Les 12 essais finaux
passent (deux acceptations, huit refus IAM, deux refus d'association SES).
La stack de sonde est `UPDATE_COMPLETE`, sans dérive. Aucun déploiement de
workload applicatif ni activation commerciale. Voir le
[rapport des sondes réelles](ses-real-probe-2026-09-10.md).

## État SES relu le 10 septembre (inchangé par la journalisation)

Nouveau compte : `ProductionAccessEnabled=false`, `SendingEnabled=true`,
`EnforcementStatus=HEALTHY`, quota `200/jour`, débit `1/seconde`,
`SentLast24Hours=0` lors de la lecture initiale avant les sondes. Les acceptations
synthétiques ultérieures sont détaillées dans le rapport ; ce compteur initial
n'est pas une mesure après essai. Le compte reste un sandbox, pas une preuve de
livraison ni une autorisation commerciale.

Compte existant `274319534967` : `ProductionAccessEnabled=false`, revue
`DENIED`. La création du compte de test ne contourne pas cette décision AWS et
ne rend pas SES commercialisable.

## Reprise

1. Réception des notifications sur l'adresse administrative : confirmée.
2. Journalisation durable et présence d'un dispositif MFA SSO : confirmées.
   La politique d'obligation MFA et la centralisation root restent à évaluer
   séparément, sans imposer de changement global à l'organisation.
3. Reprendre la sonde IAM privée prévue dans le
   [rapport du 7 septembre](ses-iam-certification-2026-09-07.md), exclusivement
   avec le profil `yodev-mail-test` et une assertion STS sur `764858776290`.
4. Vérifier les cas positifs et négatifs sans ouvrir les gates de production.
   L'approbation SES, Stripe Live/TVA, restauration Neon et canaris restent des
   conditions indépendantes du GO commercial.

Vérifications de l'amorçage : API Organizations, Identity Center, STS, SES,
IAM, CloudTrail et AWS Budgets ; lecture UI OVH ; `git diff --check`.
La reprise ajoute les contrôles CDK, KMS, S3 et les tests locaux détaillés
plus haut. Aucun déploiement applicatif de production n'est inclus dans cette
fondation de test.

## Sources

- [Création de compte Organizations](https://docs.aws.amazon.com/organizations/latest/APIReference/API_CreateAccount.html).
- [Filtre de budget par compte lié](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-create-filters.html).
- [Redirections OVH](https://docs.ovhcloud.com/fr/guides/web-cloud/email-and-collaborative-solutions/common-email-features/feature-redirections).
