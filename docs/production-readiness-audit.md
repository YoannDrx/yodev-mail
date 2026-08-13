# Audit de préparation à la production

Version du 13 août 2026. Ce document est le registre de décision du lancement interne. Il distingue volontairement le code, les tests, la configuration, le déploiement et la preuve réelle.

## Légende

- ✅ : preuve disponible et reproductible.
- ⚠️ : partiel, conditionnel ou preuve insuffisante.
- ❌ : absent ou non prouvé.
- ⏳ : dépendance externe ou observation en cours.

Une ligne n’est « prête production » que si ses cinq colonnes sont ✅. Un test simulé ne vaut jamais une preuve fournisseur réelle.

## Photographie de départ

- Branche de travail : `codex/mail-better-auth-launch`, base `1e4c3ca` avant les corrections de cet audit.
- Production Vercel observée : `main` au commit `4d49780`, donc antérieure au cutover Better Auth.
- Base liée : 44 tables et migration Better Auth visibles ; un workspace `pending_review`, sans domaine, binding, profil, template, clé, message ni webhook.
- Qualité de départ : `npm run check` vert, 38 tests unitaires et 5 tests Playwright publics ; couverture 53,04 % des lignes et 18,78 % des fonctions.
- Postmark : compte déclaré approuvé, mais aucun envoi traversant Mail by Yodev n’est encore prouvé.
- AWS : session locale expirée. Toute conclusion sur SES, les stacks, le drift, SQS, Lambda et les alarmes reste suspendue à `aws login`.
- Better Auth : variables de base présentes dans Vercel, mais les identifiants Google Preview/Production n’ont pas été trouvés dans l’inventaire sans secrets.

## État après remédiation locale

- `npm run check` est vert avec 51 tests unitaires, puis `npm run test:e2e` est vert avec 5 scénarios publics.
- La couverture est passée à 55,76 % des lignes, 25 % des fonctions, 54,62 % des statements et 43,66 % des branches. Elle reste insuffisante pour qualifier seule le cœur d’envoi.
- `npm run infra:synth` est vert. Le `cdk diff`, le drift et les contrôles AWS réels restent bloqués par la session AWS expirée.
- Une branche de restauration Mail by Yodev `backup-pre-pilot-readiness-20260813` (`br-fancy-silence-as6qxmvd`) et une branche de répétition `test-pilot-readiness-20260813` (`br-restless-truth-as9zo1i6`) ont été créées. La migration `0008` y est appliquée et journalisée ; la branche principale reste à 8 migrations et sans les nouveaux champs.
- Une branche de restauration `yodev-ads` `backup-pre-yodev-mail-canary-20260813` (`br-cold-tree-awixfsw1`) et une branche de répétition `test-yodev-mail-canary-20260813` (`br-dawn-block-awatm9cb`) ont été créées.
- Le replay `yodev-ads` a établi que sa branche principale n’a que 6 migrations, jusqu’à `0005`, alors que le dépôt en contient 34. Les migrations `0006` à `0033` passent toutes dans l’ordre sur la branche de répétition, avec 34 entrées au journal. La table `yodev_mail_events` y possède exactement cinq colonnes ; `yodev_system` peut la lire et `yodev_app` ne le peut pas. `job_attempts.provider_message_id` conserve l’identifiant opaque retourné par le transport sans adresse ni contenu.
- `yodev-ads` passe son contrôle complet : lint, TypeScript, garde-fous DB, sérialisation transactionnelle, 631 tests, build Next.js et 6 tests Playwright.

## Matrice de readiness

| Fonctionnalité | Implémentée | Testée automatiquement | Configurée | Déployée | Prouvée en réel | Criticité / clôture |
|---|---:|---:|---:|---:|---:|---|
| Trois hôtes, pages publiques et légales | ✅ | ✅ | ✅ | ✅ | ✅ | P2, smoke public à rejouer après cutover |
| Politique anti-abus et absence de campagnes publiques | ✅ | ⚠️ | ✅ | ✅ | ⚠️ | P1, conserver les anciennes tables inactives puis contraction séparée |
| Better Auth, session et déconnexion | ✅ | ⚠️ | ❌ | ❌ | ❌ | P0, ajouter Google OAuth en Preview et exécuter le parcours réel |
| Invitations, bootstrap unique et organisations | ✅ | ⚠️ | ❌ | ❌ | ❌ | P0, preuve multi-utilisateur et impossibilité d’inscription libre |
| Passkeys et changement de workspace | ✅ | ⚠️ | ❌ | ❌ | ❌ | P1, Playwright authentifié en Preview |
| Onboarding, validation admin et audit | ✅ | ⚠️ | ⚠️ | ❌ | ❌ | P0, approuver uniquement après le cutover |
| Droit pilote interne audité, 90 jours maximum | ✅ | ✅ | ❌ | ❌ | ❌ | P0, migration `0008`, octroi admin avec raison `internal_canary` |
| Domaines et sélection explicite du fournisseur | ✅ | ⚠️ | ❌ | ❌ | ❌ | P0, DNS réel puis activation atomique |
| Provisionnement Postmark et contrôle `DeliveryType` | ✅ | ✅ | ❌ | ❌ | ❌ | P0, un Server Sandbox est refusé en production |
| Profil transactionnel et politique `template_only` | ✅ | ⚠️ | ❌ | ❌ | ❌ | P0, créer et approuver `operations_alert` |
| Templates, variables obligatoires et échappement | ✅ | ✅ | ❌ | ❌ | ❌ | P0, template canari à créer et approuver |
| Clés test/live, scopes et révocation | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | P0, intégration DB isolée et clés canari à créer |
| API `POST /v1/emails` | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | P0, contrat Postmark simulé vert ; E2E réel manquant |
| Idempotence canonique et concurrence | ✅ | ⚠️ | n/a | ❌ | ❌ | P0, hash corrigé ; course DB à prouver sur branche Neon |
| API `GET /v1/emails/{id}` | ✅ | ⚠️ | n/a | ❌ | ❌ | P0, `failedAt` et `ambiguousAt` désormais distincts |
| Quota, réservation, ledger et usage mensuel | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | P0, scénario transactionnel concurrent manquant |
| Envoi Postmark et classification 4xx/429/5xx/timeout | ✅ | ✅ | ❌ | ⚠️ | ❌ | P0, test HTTP simulé vert ; Server Live réel requis |
| Récupération des messages `sending` anciens | ✅ | ⚠️ | ❌ | ❌ | ❌ | P0, passe à `unknown`, alerte et ne rejoue jamais |
| Événements fournisseur, ordre et déduplication | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | P0, livraison/bounce/plainte réels manquants |
| Suppressions et auto-suspension | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | P0, hard bounce réel et blocage avant fournisseur à prouver |
| Webhooks clients signés | ✅ | ⚠️ | ❌ | ⚠️ | ❌ | P0, endpoint canari à créer |
| Webhooks : 8 essais / 72 h et état terminal | ✅ | ✅ | ❌ | ❌ | ❌ | P0, erreurs HTTP planifiées via outbox, crashes via SQS |
| SSRF, DNS à chaque tentative et redirections bloquées | ✅ | ✅ | n/a | ❌ | ❌ | P0, test de rebinding sur environnement contrôlé encore requis |
| Outbox, quatre SQS et quatre DLQ | ✅ | ⚠️ | ⏳ | ⏳ | ❌ | P0, redrive et drift après authentification AWS |
| Visibility timeouts et concurrence des workers | ✅ | ✅ | ⏳ | ⏳ | ❌ | P0, 360–420 s pour Lambda 60 s, concurrence maximale 2 |
| Logs sans contenu et métriques opaques | ⚠️ | ⚠️ | ⏳ | ⏳ | ❌ | P1, revue CloudWatch réelle obligatoire |
| Alarmes erreurs, throttles, P99, queues, DLQ, `unknown` | ✅ | ✅ | ⏳ | ⏳ | ❌ | P0, synthèse locale seulement tant qu’AWS est inaccessible |
| Stripe checkout, portail, webhooks et meter | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | P2 pour le canari, P0 avant commercialisation |
| Pièces jointes S3/KMS/GuardDuty | ⚠️ | ⚠️ | ❌ | ⏳ | ❌ | P2 canari, API à garder indisponible jusqu’au scan réel |
| Migrations Drizzle et restauration Neon | ✅ | ✅ | ✅ | ❌ | ❌ | P0, répétitions isolées vertes ; appliquer `0008` et rattraper `yodev-ads` de `0006` à `0032` avant les déploiements concernés |
| Isolation multi-tenant | ✅ | ⚠️ | ⚠️ | ⚠️ | ❌ | P0, suite DB workspace A/B obligatoire |
| CI et build | ✅ | ✅ | ✅ | ⚠️ | ⚠️ | P1, la production ne contient pas encore ces corrections |
| Rollback fournisseur sans fallback automatique | ✅ | ⚠️ | ❌ | ❌ | ❌ | P0, exercice manuel Postmark vers Resend requis |
| Transport canari `yodev-ads` | ✅ | ✅ | ❌ | ❌ | ❌ | P0, activation par `OPERATIONS_EMAIL_PROVIDER=yodev_mail` uniquement |
| Webhook canari `yodev-ads` minimal et dédupliqué | ✅ | ✅ | ❌ | ❌ | ❌ | P0, migration `0032` additive et secret distinct requis |
| Amazon SES sandbox et événements | ✅ | ⚠️ | ⏳ | ⏳ | ❌ | P2 lancement, `SES_ENABLED=false` reste obligatoire en prod |
| Accès production Amazon SES | n/a | n/a | ⏳ | n/a | ❌ | P3 lancement, dossier après 30 jours de trafic propre |

## Corrections implémentées pendant l’audit

1. Le hash d’idempotence utilise désormais une sérialisation JSON canonique récursive.
2. Les templates refusent toute variable référencée absente, supportent les clés avec points, échappent les valeurs HTML et neutralisent CR/LF dans le sujet.
3. `failedAt` et `ambiguousAt` sont stockés et retournés séparément.
4. Un message `sending` dont le lease dépasse quinze minutes devient `unknown`, libère sa réservation, émet une métrique et n’est jamais renvoyé automatiquement.
5. Le droit pilote est un champ interne daté, accordé uniquement par un administrateur à un workspace approuvé, pour 30, 60 ou 90 jours au maximum, avec audit `internal_canary`.
6. Les échecs webhooks attendus créent une nouvelle tâche outbox différée ; huit tentatives tiennent dans 72 heures et l’épuisement produit un état terminal et une alarme.
7. Les quatre visibility timeouts SQS sont au moins six fois le timeout Lambda ; les quatre event source mappings sont plafonnés à deux exécutions concurrentes.
8. Le provisionnement Postmark contrôle le `DeliveryType` lu par API et refuse un Server incompatible.
9. Les recherches d’événements fournisseur par identifiant sont désormais resserrées au workspace annoncé.
10. `yodev-ads` possède un transport explicite vers le template `operations_alert`, une idempotence stable, aucun fallback Resend automatique, un identifiant fournisseur persisté dans l’audit de tentative et un webhook minimal signé/dédupliqué.
11. Une réponse Postmark `2xx` malformée ou sans preuve d’acceptation est classée `ambiguous`, jamais comme rejet définitif ni comme autorisation de rejouer automatiquement.

## P0 ouverts avant tout canari live

1. Appliquer `0008` sur la base Mail by Yodev au moment du cutover et rattraper la base principale `yodev-ads` de `0006` à `0033` avant d'y déployer le webhook. Les branches de restauration et répétitions isolées sont déjà validées.
2. Configurer Google OAuth Better Auth en Preview, puis prouver session, invitation, passkey, logout et changement de workspace.
3. Fusionner et déployer seulement après les tests Preview ; retirer Clerk après preuve production.
4. Réauthentifier AWS, vérifier drift, queues, rôles, schedules, alarmes et `SES_ENABLED=false`.
5. Inventorier Postmark par API sans révéler les tokens, créer ou confirmer un Server Live distinct et vérifier DKIM, Return-Path, DMARC et webhooks sans contenu.
6. Créer et approuver le workspace, le droit pilote, `yodev.fr`, le profil, le template, les clés et l’endpoint webhook.
7. Exécuter la suite d’intégration sur une branche Neon et les scénarios fournisseur réels.
8. Déployer le canari `yodev-ads`, observer 72 heures, puis documenter chaque preuve.

## Format de preuve de clôture

Pour chaque ligne clôturée, joindre : date UTC, environnement, commit, acteur, commande ou scénario, identifiants opaques concernés, résultat attendu, résultat observé, lien vers le déploiement ou l’alarme, et rollback vérifié. Ne joindre aucune adresse, aucun sujet, contenu, token ou secret.
