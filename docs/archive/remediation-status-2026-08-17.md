# État d’implémentation des remédiations - 17 août 2026

> Historique figé au 17 août. Les preuves actualisées (couverture imposée,
> répétition/restauration Neon, audit AWS et certification Postmark en lecture
> seule) sont consignées dans `docs/hardening-status-2026-08-18.md`.

## Décision actuelle

`NO-GO commercial` et `NO-GO déploiement immédiat` tant que les preuves externes ci-dessous ne sont pas complètes. Le worktree local contient les corrections, mais aucune migration, variable, ressource AWS ou version Vercel n’a été appliquée à la production.

Le code est volontairement fail-closed : l’onboarding commercial, le checkout live, le reporting Stripe, les pièces jointes, le contenu raw et l’acceptation live sont fermés par défaut. Le service déjà déployé n’hérite d’aucune de ces corrections avant un déploiement contrôlé.

## Remédiations implémentées

| Domaine | Résultat local | Gate ou preuve encore requise |
|---|---|---|
| Création d’un client | Provisioning atomique organisation/workspace/settings/subscription/review/invitation ; propriétaire lié à l’acceptation | Migration `0009`, parcours réel A/B en Preview, `COMMERCIAL_ONBOARDING_ENABLED` |
| Isolation | Écritures nouvelles bornées par `workspaceId`, unicité globale des domaines, verrou d’ownership parent/sous-domaine | Suite authentifiée avec deux organisations réelles |
| Checkout Stripe | Catalogue v2 vérifié, tentative pending unique, idempotence, Tax/CGV/SCA, session récupérable et expiration figée à une heure | Fiscalité validée, achat test puis live, expiration des sessions pending au rollback, `LIVE_CHECKOUT_ENABLED` |
| Webhooks Stripe | Signature, corps borné, événement durable récupérable, réduction ordonnée, catalogue/mode/tenant vérifiés | Replays test/live et événements désordonnés réels |
| Usage Stripe | Un job figé par message accepté pour les droits `active`, `trialing` ou `past_due`, timestamp d’acceptation, aucun replay d’un résultat ambigu | Worker test/live, reconciliation `unknown`, `STRIPE_USAGE_REPORTING_ENABLED` |
| Envoi | Gate live, transition fournisseur/DB atomiquement vérifiée, conflit classé `unknown` | Trois canaris et observation 72 h, `LIVE_EMAIL_ACCEPTANCE_ENABLED` |
| API | Corps bornés, erreurs 413/415, CR/LF neutralisés, raw et attachments indépendamment fermés | E2E authentifié, charge/concurrence sur Preview |
| Webhooks clients | Validation DNS complète, re-résolution au socket, TLS, aucun redirect, signature/retry terminal | Endpoint réel contrôlé et scénario DNS/retry en Preview |
| Postmark | IP officielles du 17 août 2026, Basic Auth constant-time, ServerID et workspace contraints, payload borné | Webhook fournisseur réel et tests officiels bounce/complaint |
| Données | Corps 30 j, pièces jointes 24 h, adressage/suppressions 90 j, événements/outbox/idempotence purgés | Exécution du worker sur clone et validation juridique finale |
| AWS | Lecture minimale des paramètres runtime, IAM Vercel réduit, CloudTrail management chiffré avec politique KMS explicite, alerte root, SNS chiffré, budget par paliers | Déploiement contrôlé de la fondation puis preuve de livraison CloudTrail/SNS et d’alarme |
| Supply chain | Next/CDK corrigés, CI ajoute audit, check Drizzle et synth | CI distante sur la branche publiée |

## Preuves locales enregistrées

- `npm audit --audit-level=high` : 0 vulnérabilité.
- `npm run check` : lint sans avertissement, TypeScript, 21 fichiers et 77 tests, puis build Next.js 16.3.1 de production réussis.
- `npm run test:coverage` : 77 tests verts ; 52,29 % des statements, 44,56 % des branches, 27,38 % des fonctions et 54,12 % des lignes. L’ajout du Route Handler d’envoi au périmètre mesuré fait baisser le pourcentage tout en augmentant le nombre de lignes exécutées ; le cœur orchestration/workers reste sous-couvert et interdit toute affirmation « 100 % testé ».
- Playwright : 5/5 parcours publics et anonymes verts ; aucune preuve authentifiée ou multi-tenant n’est incluse dans ces cinq scénarios.
- CDK : 13 tests d’infrastructure verts et synthèse complète réussie, dont la politique KMS CloudTrail (`GenerateDataKey` et `DescribeKey`, `SourceArn` et contexte de chiffrement) et l’ouverture explicite du worker d’usage uniquement sur une charge active.
- TypeScript et Drizzle : typecheck vert, `drizzle-kit check` vert.
- PostgreSQL 17 jetable : installation Drizzle complète réussie, 10 migrations journalisées, 47 tables.
- PostgreSQL 17 jetable : répétition séparée `0008 → préflight → 0009` réussie.
- Contraintes `0009` : doublons de domaine, review, checkout pending et job d’usage effectivement rejetés.
- Documentation Postmark primaire : les quatre IP webhook codées correspondent à la liste officielle publiée.
- Recherche locale et historique Git des motifs de clés live Stripe/AWS, secrets de webhook et clés privées : aucun motif détecté. `gitleaks` n’est pas installé ; cette recherche ciblée ne remplace donc pas un scan dédié en CI.
- Le conteneur PostgreSQL 17 jetable utilisé pour les répétitions de migration a été arrêté puis supprimé.

Toutes ces preuves locales ont été rafraîchies après le dernier changement. CDK signale 81 feature flags instables non configurés ; ce message n’empêche pas la synthèse, mais les changements de contexte CDK devront rester explicitement revus lors des futures montées de version.

## Constat AWS live en lecture seule

La session AWS a été réauthentifiée le 17 août 2026. Aucune API de mutation, récupération de valeur SecureString, création de drift, migration ou déploiement n’a été exécutée.

| Surface live | Résultat observé | Écart avec le code local |
|---|---|---|
| CloudFormation | Fondation, développement et production en `UPDATE_COMPLETE` ; protection de terminaison active sur production et fondation | Le diff sans change set ne montre pas de remplacement de ressource de production, mais la fondation ajoute les contrôles d’audit ci-dessous |
| CloudTrail | Aucun trail présent dans le compte | Le code local ajoute un trail management multi-région, validation de fichiers, S3 et CloudWatch chiffrés, rétention un an et alerte d’usage root |
| Alertes | 58 alarmes en production : 56 `OK`, 2 alarmes de réputation SES sans données, aucune en `ALARM` | Le topic SNS live n’est pas chiffré ; le code local lui associe la clé KMS d’audit |
| SQS | Huit files inspectées, toutes vides, chiffrées et protégées par TLS ; quatre mappings production activés ; DLQ vides | Les permissions runtime locales sont plus étroites que celles déployées |
| Lambdas et logs | Douze Lambdas production ; rétention des logs à 90 jours | Le code local sépare les paramètres runtime par worker au lieu de donner les trois paramètres à tous les workers |
| Vercel OIDC | Audience et sujet production sont bornés à l’équipe, au projet et à l’environnement attendus | Le rôle live possède encore des droits S3/KMS/SQS plus larges ; le code local retire le déchiffrement des pièces jointes, borne l’écriture à `pending/*` et retire l’envoi direct dans la file email |
| GuardDuty Malware Protection | Deux plans autonomes actifs, bornés aux préfixes `pending/` des buckets développement et production | Aucun écart critique pour l’upload ; le gate applicatif des pièces jointes reste fermé par défaut |
| SES | Compte encore en sandbox, quota faible, aucune identité vérifiée ; `SES_ENABLED=false` dans la charge de travail | SES ne peut pas servir de transport commercial de secours à ce stade ; Postmark reste le transport actif attendu |
| S3 pièces jointes | Chiffrement KMS, blocage public, TLS et expiration à un jour ; versioning désactivé | Acceptable pour des objets éphémères à usage unique ; le gate applicatif reste fermé jusqu’aux tests de scan réels |
| Paramètres | Huit paramètres `SecureString` inspectés par métadonnées uniquement | Un ancien paramètre runtime apparaît encore ; il doit être retiré après vérification des consommateurs, sans lire sa valeur |
| Sécurité compte | MFA root actif et aucune clé d’accès root | CloudTrail, Security Hub, AWS Config et Access Analyzer ne sont pas encore actifs ; CloudTrail est le préalable avant bêta, les trois autres sont recommandés en P2 |

Le diff de fondation remplace la ressource Budget parce que son nom et ses seuils changent. Le topic SNS live possède déjà un abonnement confirmé géré hors de cette définition : ne pas renseigner simultanément une nouvelle destination d’alerte au déploiement sans décider explicitement qui en assure la gestion, afin d’éviter un doublon.

## Gates externes non prouvées

1. Le compte Neon exposé au connecteur ne présente aucun projet `yodev-mail` et aucun projet partagé. La migration n’a donc pas encore été répétée sur une branche enfant de la vraie base.
2. Un compte Stripe live dédié `YoDevMail` doit être créé sous une organisation `Yodev`, avec ses propres sandboxes. Le connecteur réauthentifié expose actuellement un autre produit ; aucune donnée métier de ce compte n’a été auditée.
3. AWS live est désormais audité en lecture seule, mais le CloudTrail, le chiffrement SNS et les politiques IAM corrigées ne sont pas déployés ; leur fonctionnement réel n’est donc pas encore prouvé.
4. Le futur compte Stripe YoDevMail devra être relié au connecteur et aux environnements applicatifs sans donner accès aux autres produits. Aucune clé Stripe locale n’est présente.
5. Aucun parcours Better Auth réel à deux tenants, Google OAuth ou passkey Touch ID n’a été exécuté sur cette version.
6. Aucun canari Gmail/Outlook/iCloud, bounce ou plainte officielle Postmark n’a été exécuté sur cette version.
7. Aucun checkout Stripe test/live, facture, portail, annulation, remboursement ou meter event réel n’a été exécuté sur cette version.
8. La configuration fiscale Stripe et la formulation TVA doivent être validées avant toute charge live.
9. La restauration Neon mesurée et les objectifs RPO/RTO restent à prouver.

## Décision d’architecture Stripe

- Le propriétaire conserve une seule identité personnelle sécurisée par passkey ou clé de sécurité.
- Une organisation Stripe `Yodev` centralise la propriété et le reporting.
- Chaque produit commercial autonome possède un compte live distinct. RoutineKids et YoDevMail ne partagent ni clients, ni catalogue, ni clés, ni webhooks, ni factures.
- Chaque compte live possède ses propres sandboxes de développement et de staging ; une sandbox n’est pas un compte live supplémentaire.
- La règle ne s’applique pas automatiquement à chaque dépôt, prototype ou outil interne. Les autres projets feront l’objet d’un inventaire avant création.
- Les connecteurs et automatisations reçoivent uniquement l’accès au compte requis par leur tâche ; aucun accès transversal à tous les produits par défaut.

## Ordre de mise en service

1. Publier une branche de revue et obtenir une CI verte ; ne modifier aucun gate.
2. Créer l’organisation Stripe `Yodev` si nécessaire, puis le compte live `YoDevMail` et ses sandboxes dédiées. Ne pas copier de données, clés ou webhooks depuis un autre produit.
3. Créer la branche Neon liée, exécuter le préflight, migrer, tester A/B et restaurer un point de sauvegarde.
4. Faire relire le diff AWS enregistré, déployer d’abord la fondation passive ; confirmer la livraison CloudTrail, le chiffrement SNS, l’abonnement d’alerte existant et l’alarme root sans déclencher d’usage root volontaire en production.
5. Déployer Preview avec tous les gates fermés, puis tester l’onboarding et l’isolation A/B avec le seul gate commercial temporairement ouvert.
6. Certifier Postmark et l’envoi interne ; conserver le transport précédent et observer 72 heures.
7. Configurer et certifier Stripe dans la sandbox YoDevMail, valider fiscalité/CGV, puis exécuter l’achat live autorisé sur le compte YoDevMail et son remboursement.
8. Ouvrir séparément usage, checkout puis onboarding commercial en production. Les pièces jointes restent indépendantes ; le raw n’est pas nécessaire au lancement.

Tout P0/P1, résultat ambigu non réconcilié, accès croisé, doublon, DLQ inexpliquée ou incohérence fiscale referme les gates et maintient le `NO-GO`.
