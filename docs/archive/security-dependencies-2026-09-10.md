# Correctifs de dépendances - 10 septembre 2026

Correctif isolé depuis `main` (`7436dd3`), sans les permissions SES de la PR #44.
Aucune modification de schéma, de secret, de gate commerciale ou de permission
AWS. La validation de ce correctif ne vaut pas GO commercial.

## Constat et correction

L'audit npm du verrou précédent signale notamment une alerte critique Next.js
sur l'optimisation d'images AVIF via sharp/libheif, et une alerte distincte sur
les serveurs Windows. La présence d'une version concernée ne prouve ni une
exploitation ni une exposition de tous les chemins vulnérables. Aucun test
d'exploitation n'a été lancé contre la production.

Versions verrouillées après correction :

| Composant | Avant | Après |
| --- | --- | --- |
| Next.js / eslint-config-next | 16.3.1 | 16.3.4 |
| sharp | 0.35.3 | 0.35.4 |
| js-yaml | 4.3.1 | 4.3.2 |
| hono | 4.13.1 | 4.13.7 |
| csv-parse | 7.0.1 | 7.0.2 |
| Vitest / coverage-v8 | 4.1.10 | 4.1.11 |

Les binaires Next/sharp associés et les dépendances transitives du runner de
tests sont actualisés dans le lockfile. Pas de saut vers Vitest 5 ni js-yaml 5.
Pas de codemod requis pour cette mise à jour corrective de Next.js 16.3.
Les correctifs hono et csv-parse recouvrent les PR Dependabot #46 et #45 ; ne pas
les fusionner séparément sans relire le nouveau verrou après ce correctif.

## Vérification locale

- `npm audit --audit-level=low` : zéro vulnérabilité signalée.
- `npm ls` : versions corrigées présentes, Vitest et couverture alignés.
- `npm run check` : lint, TypeScript, 239 tests et build Next.js 16.3.4 réussis.
- `npm run test:e2e` : huit parcours publics réussis.
- `git diff --check` : réussi.

L'installation et les tests locaux n'utilisent aucun fichier d'environnement de
production. Les tests intégrés PostgreSQL et les parcours authentifiés sont
attendus en CI avant fusion. Aucun changement de seuil de couverture ou de test
pour masquer un échec. Les avertissements de dépréciation de React Email et
l'avertissement Vite sur une future configuration native restent distincts.

## Publication

Avant publication, attendre les contrôles CI requis et le déploiement de
prévisualisation. Publier uniquement ce correctif depuis `main`, puis contrôler
la version et les endpoints de santé. Ne pas publier la branche de certification
SES. En cas d'échec, conserver les gates fermées ; un retour à `7436dd3`
réintroduirait les versions signalées et n'est pas un rollback de sécurité neutre.

### Résultat de publication

La [PR #47](https://github.com/YoannDrx/yodev-mail/pull/47) est fusionnée le
10 septembre 2026 à 12:02:26 UTC, après tous les contrôles verts de la
[CI de PR](https://github.com/YoannDrx/yodev-mail/actions/runs/34474174013) et
la prévisualisation Vercel `2988ad6` avec santé/base `ok`.
La [CI de main](https://github.com/YoannDrx/yodev-mail/actions/runs/34474488756)
est également verte pour `c5b91e4e102eae874b5e3585f03892d9a2f1506d`.

Déploiement production Vercel `dpl_6JGazXDWSjgw1ngcpFKUU8X7yBiU`, état `READY`.
Le journal de build confirme Next.js 16.3.4. À 12:04 UTC, les endpoints
`mail.yodev.fr/api/health` et `api.mail.yodev.fr/health` retournent tous deux
`status=ok`, `database=ok`, `version=c5b91e4`. Le chemin
`mail.yodev.fr/health` redirige normalement vers l'endpoint du domaine API.
Les tests authentifiés et intégrés PostgreSQL ont bien été exécutés en CI.
Aucune publication des permissions SES de la PR #44, aucune migration de
production, aucun changement de gate ou de secret dans ce correctif.

## Sources

- [Avis officiel Next.js AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4).
- [Avis officiel Next.js Windows](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36).
- [Avis sharp/libheif](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
- [Avis js-yaml](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
