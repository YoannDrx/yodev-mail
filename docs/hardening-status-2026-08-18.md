# État du durcissement YoDevMail au 18 août 2026

## Décision

YoDevMail est conservé et consolidé sur la branche locale
`codex/yodev-mail-hardening`. Ce document distingue les preuves reproductibles
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
| `npm run check` | Vert : lint, TypeScript, 86 tests et build Next.js 16.3.1 |
| `npm run test:integration` | 35 scénarios PostgreSQL 17 verts |
| `npm run test:coverage:full` | 121 tests verts avec seuils CI atteints |
| `npm run test:e2e` | 5 scénarios Playwright verts |
| `npm run infra:synth` | CDK synthétisé pour les stacks configurées |
| `npx drizzle-kit check` | Journal et schéma cohérents |
| `npm run db:preflight:0009` | Aucun doublon ou chevauchement bloquant |
| `npm audit --audit-level=high` | 0 vulnérabilité connue |
| Health checks publics | HTTP 200, base `ok`, version déployée `c0d4a80` |

La suite PostgreSQL couvre notamment l'acceptation exactement une fois, les
résultats fournisseur ambigus, les retries transitoires, le rollback d'un
événement terminal, les événements concurrents et désordonnés, la suppression,
la réconciliation propriétaire concurrente, l'idempotence API, le quota sous
concurrence, l'isolation domaine/template, le gate des webhooks clients et la
déduplication d'un webhook Stripe.

## Couverture mesurée et imposée

La suite unifiée atteint 75,01 % de statements, 65,57 % de branches, 62,89 % de
fonctions et 77,88 % de lignes. Les seuils globaux sont désormais imposés par
`vitest.full.config.ts` à 70 % pour les statements/lignes et 60 % pour les
branches/fonctions.

Les trois modules transactionnels critiques satisfont également la barrière de
90 % de lignes et de branches :

- worker d'envoi : 100 % de lignes et 90,90 % de branches ;
- ingestion fournisseur : 100 % de lignes et 92,59 % de branches ;
- réconciliation propriétaire : 97,05 % de lignes et 93,54 % de branches.

La CI PostgreSQL exécute cette suite unifiée et échoue automatiquement si l'un
de ces seuils régresse.

## CI ajoutée

La CI exécute désormais :

- audit npm, contrôle Drizzle, synthèse CDK et `npm run check`;
- Playwright sur Chromium;
- migrations Drizzle et suite de couverture complète sur un service PostgreSQL
  17 jetable.

## Preuves externes obtenues le 18 août 2026

- GitHub : la branche `codex/yodev-mail-hardening` est publiée dans la draft PR
  `#19`. Les checks qualité, intégration PostgreSQL, E2E, GitGuardian et Vercel
  sont verts. Le commit applicatif certifié est `3287919`.
- Neon : une branche de répétition a été créée depuis une branche de sauvegarde,
  `0009` a été appliquée en transaction, puis le schéma et les données ont été
  comparés. La restauration depuis le parent a réussi en 864 ms, sans écart de
  données sur les agrégats contrôlés. La base principale n'a pas été modifiée.
- AWS : les trois stacks sont `UPDATE_COMPLETE`; la détection de drift n'a
  trouvé aucun drift sur les ressources prises en charge. Les huit files de
  production, dont quatre DLQ, sont vides. Les deux plans GuardDuty Malware
  Protection S3 sont actifs sur `pending/` en développement et production.
- Le `cdk diff` ne remplace aucune ressource stateful existante. Il ajoute la
  fondation CloudTrail/KMS/alarme root et resserre les permissions IAM. Cette
  fondation n'est pas encore déployée et aucun détecteur GuardDuty général n'est
  actif en `eu-west-3`.
- SES est toujours en sandbox (200 messages/jour, 1/s). L'identité
  `mail.yodev.fr` et son MAIL FROM sont vérifiés, mais SES reste volontairement
  désactivé comme transport de production.
- Postmark : le Server PROD est `Live`; SMTP, raw email et tracking sont
  désactivés. DKIM et Return-Path sont vérifiés. Le webhook HTTPS est authentifié,
  écoute delivery/bounce/complaint, exclut le contenu et désactive open/click.
  La base contient deux messages live déjà arrivés à l'état `delivered`.
- Vercel : la production est saine mais sert encore le commit `c0d4a80`, pas ce
  durcissement. Les environnements contiennent encore des variables historiques
  de campagnes/newsletters à retirer lors d'une rotation contrôlée.
- Preview : le commit `7e796e5` est déployé sur une Preview Vercel reliée à une
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
  l'alias sert le commit `7e796e5` avec `database=ok`.
- API Preview : une clé live synthétique est refusée en 503 par le gate fermé.
  Une clé test synthétique produit exactement un message `simulated`; son replay
  renvoie le même ID, tandis qu'un corps différent avec la même idempotency key
  renvoie 409. La base confirme un message et une ligne d'idempotence, sans
  ledger, outbox ni réservation. Les deux clés ont ensuite été révoquées et le
  pepper temporaire supprimé; une nouvelle requête renvoie 401.

## Validations externes restant à exécuter

- Aucun déploiement production n'a été déclenché.
- Aucun gate live n'a été activé.
- Aucun bounce/complaint officiel Postmark n'a été provoqué sur cette version.
- Aucun checkout, paiement, webhook, facture, annulation, portail ou meter event
  Stripe réel n'a été exécuté.
- Aucun canari Gmail, Outlook ou iCloud et aucune observation de 72 heures n'ont
  été réalisés.

Le compte Stripe exposé au connecteur est `RoutineKids`, pas un compte YoDevMail.
Aucune mutation Stripe n'a donc été réalisée. Un compte dédié et sa fiscalité
restent un bloqueur commercial explicite.

La session AWS réauthentifiée utilise actuellement l'identité root du compte.
Elle a été limitée à l'audit en lecture seule et au `cdk diff`. Une organisation
AWS et une instance IAM Identity Center d'organisation ont désormais été créées
en `eu-west-3`. Le permission set `YoDevMailAdministrator` est affecté au compte
pour l'utilisateur opérateur non-root ; l'activation de son invitation et sa
première session SSO restent requises avant tout déploiement.

Les health checks publics servent toujours la version `c0d4a80`; ils prouvent
la disponibilité de l'ancienne version déployée, pas celle de la branche locale.

## Prochaine barrière de décision

Avant un GO interne, il reste à activer la session AWS non-root, déployer la
fondation avec cette identité, puis exécuter les trois canaris et observer
72 heures. La migration `0009` devra être
appliquée à la production juste avant le déploiement applicatif selon le runbook.
Stripe n'est pas requis pour ce GO et doit rester fermé jusqu'à sa certification
séparée.

Le GO commercial exige en plus le compte Stripe YoDevMail dédié, la certification
checkout/webhook/facture/portail/annulation/usage, la validation fiscale et
juridique (CGV, DPA, sous-traitants), ainsi qu'une restauration exercée après le
déploiement réel.
