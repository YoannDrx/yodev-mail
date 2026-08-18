# État du durcissement YoDevMail au 18 août 2026

## Décision

YoDevMail est conservé et consolidé. La branche `codex/production-completion` a
été fusionnée dans `main` par la PR `#22`. Ce document distingue les preuves reproductibles
obtenues localement des validations qui exigent un environnement externe réel.

Ce travail ne constitue pas encore un GO de production ou un GO commercial.
Les gates d'envoi live, de webhooks clients, de pièces jointes, de contenu brut,
de facturation d'usage et d'onboarding commercial doivent rester fermés tant que
les validations externes correspondantes ne sont pas terminées.

## Durcissement implémenté

- L'acceptation fournisseur, le ledger, le quota, la tentative, l'événement
  public et son outbox sont validés dans une seule transaction PostgreSQL.
- Un échec après réponse fournisseur ambiguë ne peut faire passer en `unknown`
  qu'un message encore `sending`; un message déjà `sent` n'est jamais dégradé.
- Les transitions terminales avant acceptation fournisseur sont atomiques avec
  la libération de réservation et la publication de l'événement.
- Les événements fournisseur verrouillent le message avec `FOR UPDATE`,
  appliquent une précédence monotone et ne font jamais reculer `lastEventAt`.
- Les hard bounces et plaintes restent traités comme événements de sécurité,
  même lorsqu'ils sont reçus tardivement.
- L'acceptation d'une invitation propriétaire Better Auth ne dépend plus du
  succès immédiat du binding applicatif. Une réconciliation idempotente est
  disponible par hook, action administrateur et worker planifié.
- Les adresses email sont normalisées avant résolution du domaine, contrôle de
  suppression et persistance.
- `CUSTOMER_WEBHOOKS_ENABLED` vaut `false` par défaut et protège les événements
  créés par l'API, le worker d'envoi et l'ingestion fournisseur.
- Stripe Checkout utilise les moyens de paiement dynamiques. La vérification du
  catalogue exige également une immatriculation Stripe Tax active avant toute
  certification commerciale.

## Preuves locales obtenues

| Contrôle | Résultat |
|---|---|
| `npm run check` | Vert : lint, TypeScript, 97 tests et build Next.js 16.3.1 |
| Suite PostgreSQL | 54 scénarios PostgreSQL 17 verts |
| `npm run test:coverage:full` | 151 tests verts avec seuils CI atteints |
| `npm run test:e2e` | 5 scénarios Playwright verts |
| `npm run infra:synth` | CDK synthétisé pour les stacks configurées |
| `npx drizzle-kit check` | Journal et schéma cohérents |
| `npm run db:preflight:0009` | Aucun doublon ou chevauchement bloquant |
| `npm audit --audit-level=high` | 0 vulnérabilité connue |
| Health checks publics | HTTP 200, base `ok`, version déployée `3f64987` |

La suite PostgreSQL couvre notamment l'acceptation exactement une fois, les
résultats fournisseur ambigus, les retries transitoires, le rollback d'un
événement terminal, les événements concurrents et désordonnés, la suppression,
la réconciliation propriétaire concurrente, l'idempotence API, le quota sous
concurrence, l'isolation domaine/template, le gate des webhooks clients et la
déduplication d'un webhook Stripe.

## Couverture mesurée et imposée

La suite unifiée atteint 78,28 % de statements, 68,80 % de branches, 65,44 % de
fonctions et 81,72 % de lignes. Les seuils globaux sont désormais imposés par
`vitest.full.config.ts` à 70 % pour les statements/lignes et 60 % pour les
branches/fonctions.

Les trois modules transactionnels critiques satisfont également la barrière de
90 % de lignes et de branches :

- worker d'envoi : 100 % de lignes et 90,90 % de branches ;
- ingestion fournisseur : 100 % de lignes et 92,59 % de branches ;
- réconciliation propriétaire : 97,05 % de lignes et 93,54 % de branches.

Les workers de pièces jointes, webhooks clients et facturation d'usage ont
désormais leurs propres seuils de non-régression. Les scénarios PostgreSQL
couvrent les événements GuardDuty dupliqués ou concurrents, un résultat propre
retardé après rejet malware, la purge S3, un worker webhook périmé après livraison
réussie et la perte de claim après soumission d'un meter event Stripe.

La CI PostgreSQL exécute cette suite unifiée et échoue automatiquement si l'un
de ces seuils régresse.

## CI ajoutée

La CI exécute désormais :

- audit npm, contrôle Drizzle, synthèse CDK et `npm run check`;
- Playwright sur Chromium;
- migrations Drizzle et suite de couverture complète sur un service PostgreSQL
  17 jetable.

## Preuves externes obtenues le 18 août 2026

- GitHub : la PR `#22` a été fusionnée dans `main`. Les checks qualité,
  intégration PostgreSQL, E2E, GitGuardian et Vercel étaient tous verts.
- Neon : une branche de répétition a été créée depuis une branche de sauvegarde,
  `0009` a été appliquée en transaction, puis le schéma et les données ont été
  comparés. La restauration depuis le parent a réussi en 864 ms, sans écart de
  données sur les agrégats contrôlés. Juste avant l'application en production,
  la branche `backup-pre-0009-prod-20260818-1816` a été créée. Le préflight a
  détecté deux revues `pending` dupliquées sur un workspace synthétique : elles
  ont été supprimées sous verrou, la revue approuvée a été conservée et un
  événement d'audit technique a été ajouté. `0009` est désormais appliquée sur
  `main` : 10 migrations, aucun doublon, trois nouvelles tables et index
  critiques valides.
- AWS : les trois stacks sont `UPDATE_COMPLETE`; la détection de drift n'a
  trouvé aucun drift sur les ressources prises en charge. Les huit files de
  production, dont quatre DLQ, sont vides. Les deux plans GuardDuty Malware
  Protection S3 sont actifs sur `pending/` en développement et production.
- La fondation AWS passive est déployée et protégée contre la suppression.
  CloudTrail multi-région livre sans erreur vers S3 et CloudWatch Logs; le
  bucket, le groupe de logs et SNS utilisent la clé KMS rotative dédiée. La
  rétention vaut un an, l'alarme d'usage root est `OK`, l'abonnement SNS est
  confirmé et les budgets YoDevMail valent 10 USD pour le compte et 5 USD pour
  GuardDuty. Aucun détecteur GuardDuty général n'est actif en `eu-west-3`.
- Le workload AWS Production durci est déployé sans remplacement stateful. Les
  workers existants et leurs permissions minimales sont à jour; le worker de
  réconciliation propriétaire est actif toutes les cinq minutes avec ses
  alarmes. Les huit files et DLQ Production sont vides. Dev reste explicitement
  en standby et n'a pas été activé.
- SES est toujours en sandbox (200 messages/jour, 1/s). L'identité
  `mail.yodev.fr` et son MAIL FROM sont vérifiés, mais SES reste volontairement
  désactivé comme transport de production.
- Postmark : le Server PROD est `Live`; SMTP, raw email et tracking sont
  désactivés. DKIM et Return-Path sont vérifiés. Le webhook HTTPS est authentifié,
  écoute delivery/bounce/complaint, exclut le contenu et désactive open/click.
  La base contient deux messages live déjà arrivés à l'état `delivered`.
- Vercel : la production sert le merge commit `3f64987`; les deux health checks
  répondent HTTP 200 avec `database=ok`. Les variables historiques de campagnes/newsletters, anciens
  tarifs Stripe, files d'import/campagne, désinscription et alias Neon non lus
  ont été retirées de Production, Preview et Development. Les deux seules
  connexions Neon conservées sont `DATABASE_URL` et `DATABASE_URL_UNPOOLED`.
  GitHub ne contient aucune variable ni aucun secret de dépôt ou d'environnement.
- Configuration locale : `.env.local` est l'unique fichier de valeurs, ignoré
  par Git et protégé en mode `0600`. Le modèle versionné `.env.example` contient
  43 clés documentées par responsabilité. `npm run env:normalize` conserve les
  valeurs reconnues sans les afficher et retire les clés obsolètes ; le premier
  passage en a retiré 15 et les suivants ont confirmé son idempotence. Les
  commandes CDK chargent désormais ce même fichier et les entrées locales
  reflètent exactement les stacks actives, GuardDuty, Postmark, le profil SSO et
  le fournisseur OIDC existant.
- Preview : la tête de branche est déployée sur une Preview Vercel reliée à une
  branche Neon dédiée où `0009` est appliquée. Les deux health checks répondent
  HTTP 200 avec `database=ok` et la bonne version. Les variables de base, URL et
  origine Better Auth sont limitées à la branche Git du durcissement.
- Better Auth Preview : un client OAuth Google dédié au projet Mail by Yodev a
  été configuré avec des origines et callbacks bornés à la production et à la
  branche Preview. Deux comptes Google contrôlés ont authentifié deux
  propriétaires réels. Un second workspace synthétique a été provisionné avec
  `COMMERCIAL_ONBOARDING_ENABLED=true` uniquement sur Preview, puis son
  invitation propriétaire a été acceptée après un échec d'email volontairement
  conservé. La réconciliation a fait passer le run de `email_failed` à
  `accepted`, lié le propriétaire une seule fois et soumis le workspace en
  `pending_review`.
- Isolation Preview : le second utilisateur reçoit une 404 sur `/admin`. Après
  acceptation d'une invitation membre contrôlée, le sélecteur propose exactement
  les deux workspaces. Tenant B affiche son quota de 50/jour, zéro message, aucun
  domaine `yodev.fr` et aucun template Yodev ; Mail by Yodev affiche son quota de
  200/jour et ses événements `operations_alert`. Le gate commercial a ensuite
  été remis à `false` sur la branche Preview et redéployé. Le health check de
  l'alias sert la tête de branche avec `database=ok`.
- API Preview : une clé live synthétique est refusée en 503 par le gate fermé.
  Une clé test synthétique produit exactement un message `simulated`; son replay
  renvoie le même ID, tandis qu'un corps différent avec la même idempotency key
  renvoie 409. La base confirme un message et une ligne d'idempotence, sans
  ledger, outbox ni réservation. Les deux clés ont ensuite été révoquées et le
  pepper temporaire supprimé; une nouvelle requête renvoie 401.

## Validations externes restant à exécuter

- L'application et les quatre Lambda modifiées sont déployées. Le stack est
  `UPDATE_COMPLETE`, les fonctions sont `Active/Successful` et les huit files et
  DLQ sont vides. L'audit post-déploiement est `BASELINE: READY`.
- `LIVE_EMAIL_ACCEPTANCE_ENABLED` a été refermé avant le déploiement coordonné.
  Le canari Postmark réalisé auparavant vers Gmail a atteint `delivered` avec
  exactement un ledger, une tentative et aucun outbox en attente. Sa clé
  éphémère a été révoquée.
- Le template de production a ensuite été corrigé pour utiliser la marque
  `Mail by Yodev`; un second canari reste requis pour prouver ce rendu corrigé.
- `ATTACHMENTS_ENABLED` a été refermé et redéployé après l'audit. Le parcours réel
  upload présigné, scan GuardDuty, envoi Gmail et purge S3 attend encore une clé
  éphémère créée avec confirmation utilisateur au moment exact de sa création.
- Aucun bounce/complaint officiel Postmark n'a été provoqué sur cette version.
- Aucun endpoint client contrôlé n'a encore certifié en production la signature,
  la re-résolution DNS, le retry et l'état terminal des webhooks.
- Aucun checkout, paiement, webhook, facture, annulation, portail ou meter event
  Stripe YoDevMail réel n'a été exécuté.
- Les canaris Outlook et iCloud, ainsi que l'observation de 72 heures, restent à
  réaliser. Le connecteur Gmail demande une nouvelle authentification avant les
  sondes `support@yodev.fr` et `abuse@yodev.fr`.

Le compte Stripe exposé au connecteur est `RoutineKids`, pas un compte YoDevMail.
Aucune mutation Stripe n'a donc été réalisée. Un compte dédié et sa fiscalité
restent un bloqueur commercial explicite.

La session root utilisée pour l'audit initial ne sera pas utilisée pour les
déploiements. Une organisation AWS et une instance IAM Identity Center
d'organisation ont été créées en `eu-west-3`. Le permission set
`YoDevMailAdministrator` est affecté à l'utilisateur opérateur, son invitation
est activée et sa première session SSO est réussie. `sts get-caller-identity`
confirme une session `AWSReservedSSO_YoDevMailAdministrator`, non-root, dans le
compte attendu.

Les health checks publics servent la version `3f64987`. Le smoke test authentifié
de `/dashboard/membres` confirme un propriétaire, zéro invitation et la limite de
trois sièges. Le nom du workspace a été aligné transactionnellement sur
`Mail by Yodev` avec une trace d'audit.

## Prochaine barrière de décision

Avant un GO interne, il reste à terminer le canari Gmail corrigé, exécuter les
canaris Outlook et iCloud et observer 72 heures.
Les pièces jointes et webhooks clients peuvent rester fermés pour le pilote
transactionnel interne, mais ne peuvent être annoncés comme opérationnels avant
leurs canaris réels respectifs. La migration Production, le workload AWS, la
fondation passive et l'identité SSO
non-root sont désormais vérifiés. Stripe n'est pas requis pour ce GO et doit
rester fermé jusqu'à sa certification séparée.

Le GO commercial exige en plus le compte Stripe YoDevMail dédié, la certification
checkout/webhook/facture/portail/annulation/usage, la validation fiscale et
juridique (CGV, DPA, sous-traitants), ainsi qu'une restauration exercée après le
déploiement réel.
