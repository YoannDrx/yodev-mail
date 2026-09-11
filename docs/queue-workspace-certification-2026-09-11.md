# Contrats de files et point de mise en production - 11 septembre 2026

**Pas de GO commercial.** Ce lot est corrigé et vérifié localement ; sa
publication est préparée en PR brouillon, sans fusion ni déploiement AWS.
La dernière version publiée vérifiée le 10 septembre est `a65f72d` (PR #44).
Les preuves de cette publication sont conservées dans le
[rapport SES réel](ses-real-probe-2026-09-10.md), pas réattribuées à ce lot.

## Défauts reproduits puis corrigés

- Le job d'envoi ne contenait pas de workspace. Le premier claim sélectionnait
  uniquement l'identifiant du message. Un test avec un autre workspace fourni
  au worker déclenchait effectivement le fournisseur simulé avant correction.
- Le callback client présentait le même défaut : son premier accès utilisait
  l'identifiant de livraison sans workspace fourni par la tâche. Le test
  inter-workspace effectuait effectivement un appel HTTP simulé avant correction.
- Les deux handlers acceptaient les enveloppes sans workspace et les champs
  supplémentaires. Deux autres tests ont confirmé ce comportement avant correction.
- Le helper SQS batch ignorait `Failed` sur une réponse HTTP réussie. Il lève
  maintenant une erreur fixe dès un échec partiel, sans annoncer un succès total
  ni publier les lots suivants. Ce helper n'a pas d'appelant métier actuel.
- L'outbox conservait le texte brut des exceptions. Elle enregistre maintenant
  `outbox_dispatch_failed`, sans adresse ni contenu provenant de l'exception.

Les corps publiés sont strictement `{workspaceId, messageId}` ou
`{workspaceId, deliveryId}`, avec deux UUID. Les producteurs et consommateurs
partagent leur validation. Les workers filtrent par workspace dès leur première
lecture/écriture ; aucune recherche globale de rattrapage. Un couple valide
mais sans enregistrement correspondant est sans effet, comme un job obsolète.
Un corps malformé rejoint les échecs partiels SQS, sans journaliser son contenu.

Ces tests reproduisent une insuffisance de défense à la frontière interne des
files, pas la preuve qu'un client externe pouvait publier directement dans SQS.
Les contrôles API, IAM et les gates existants restent des protections distinctes.

## Vérifications locales

| Contrôle | Résultat |
| --- | --- |
| Régressions avant correction | 4 tests en échec : envoi et callback, workspace et contrat |
| Envoi / outbox / callback, PostgreSQL réel local | 52 tests réussis |
| `npm run check` | lint, types, 287 tests unitaires/infrastructure et build réussis |
| `npm run test:coverage:full` | 411 tests dans 54 fichiers, seuils inchangés respectés |
| Couverture des fichiers instrumentés | lignes 76,37 %, branches 69,54 % |
| Worker d'envoi | lignes 100 %, branches 90,90 % |
| Worker callback | lignes 93,18 %, branches 88,88 % |
| `npm run test:e2e` | 8 parcours publics réussis |
| `npm run test:e2e:auth` | 8 parcours authentifiés réussis |
| `npm audit --audit-level=high` | aucune vulnérabilité signalée |
| `npx drizzle-kit check` / `git diff --check` | réussis |

Les tests locaux utilisent le conteneur dédié
`yodev-mail-certification-20260906`, uniquement `127.0.0.1:55441`, bases
`yodev_mail_test` et `yodev_mail_auth_e2e`. Aucun schéma ni donnée Neon modifié.
Les fournisseurs, SQS et l'HTTP des callbacks sont simulés dans les tests workers.
L'authentification navigateur est réelle mais locale, avec comptes synthétiques
et authentificateur WebAuthn virtuel. Aucun email client ni paiement réel.
La couverture ne représente pas la certification de tous les parcours externes.

Revue du diff, des appelants et des contrats voisins : aucun autre défaut
bloquant identifié dans ce lot ; risque de migration de file ci-dessous.
Les compétences de revue des bugs, AWS SDK et vérification navigateur ont guidé
ces contrôles. `agent-browser` absent : recours aux scénarios Playwright du dépôt.

## Publication coordonnée obligatoire

1. Reconnecter les profils AWS existants par SSO et confirmer les comptes/régions.
   Le 11 septembre, les profils admin/test ont répondu avec un jeton expiré.
   La tentative de connexion interactive a elle-même expiré sans approbation.
2. Vérifier à nouveau le standby, les gates et l'inventaire SQS/DLQ sans consommer
   ou supprimer de messages. L'inventaire antérieur ne prouve pas l'état actuel.
3. Garder ce lot groupé : outbox, worker d'envoi, worker callback et helper web.
   Synthétiser, relire le diff AWS, puis publier Dev/Prod en standby. Aucun
   remplacement de ressource de stockage ou changement de schéma attendu.
4. Réconcilier individuellement tout ancien job sans workspace avec les
   enregistrements possédés en base, état d'envoi et tentatives compris. Ne pas
   purger ni rediffuser aveuglément. Sans réconciliation, le nouveau consommateur
   refuse ces jobs et ils peuvent aboutir en DLQ au démarrage du transport.
5. Vérifier les assets réellement déployés, puis certifier la chaîne isolée
   avant toute activation du transport. Un rollback doit aussi rester groupé
   et en standby ; ne pas rétablir des consommateurs permissifs en transport actif.

## Vue actualisée des conditions d'ouverture

| Volet | Preuve disponible | Ce qui reste nécessaire |
| --- | --- | --- |
| SES IAM / DNS / SendEmail | 56 contrôles réels du 10 septembre dans le compte test, dont 2 acceptations simulateur ; correctif #44 publié en standby | Chaîne applicative complète, associations historiques, retour EventBridge/SQS et ledger |
| Accès SES commercial | Dernière lecture du 10 septembre : production false, revue DENIED | Décision favorable AWS ; statut non relu le 11 faute de SSO |
| Stripe Live | Lecture du 11 septembre : charges/payouts/details false, requirements.past_due | Dossier entreprise, représentant, banque et conditions par le propriétaire ; choix fiscal réel, catalogue et parcours de facturation certifiés |
| Neon | Projet round-star-39482619, free_v3, 10 branches/10, rétention 6 h, main non protégée, 2 branches ready et 8 archivées | Choix explicite d'une ancienne branche libérable ou capacité supplémentaire, puis exercice de restauration isolé et mesure de reprise |
| Authentification | 8 parcours Chromium authentifiés verts | Google OAuth réel, emails d'authentification et passkeys physiques/multinavigateurs |
| Postmark / pièces jointes | Correctifs et tests antérieurs disponibles | Vérifications fournisseur réelles et parcours scan/expiration ; garder les options non certifiées fermées |
| Exploitation | Protections et scripts présents ; dernier standby vérifié le 10 septembre | Alertes actives en certification, reprise/DLQ, canaris contrôlés sur 72 h après prérequis |

Neon indique une période du `2026-09-01T00:00:00Z` au
`2026-10-01T00:00:00Z`. Les quotas mensuels Free se renouvellent au début de
la période suivante ; le nombre de branches occupées n'est pas un quota mensuel
remis à zéro. La lecture de projet ne suffit pas à certifier une projection
de facture mensuelle par application : ne pas extrapoler ses compteurs cumulés
sans série de consommation explicitement bornée. Aucun achat Launch ni
suppression de sauvegarde effectué. Aucune automation de canaris créée.

## Références

- [SQS SendMessageBatch : succès HTTP et échecs individuels](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_SendMessageBatch.html).
- [Neon : quotas Free et renouvellement](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md).
- [Objectif global et lots précédents](production-implementation-2026-09-06.md).
