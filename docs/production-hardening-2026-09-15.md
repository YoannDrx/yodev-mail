# YoDevMail - implémentation du 15 septembre 2026

## État et périmètre

Lot de code sur `codex/retention-postmark-hardening`, basé sur `main` (`100a917`).
**Pas encore appliqué en production. Le NO-GO commercial reste en vigueur.**
Ce document complète l'[audit du jour](production-readiness-audit-2026-09-15.md),
sans transformer les constats externes datés en validations nouvelles.

L'accès AWS SSO, initialement expiré, a été rétabli pendant cette intervention.
Stripe reste à reconnecter. Les contrôles AWS frais sont consignés ci-dessous.
Aucune migration distante, purge réelle, modification de droits pilote,
activation d'envoi, paiement, nouvelle demande d'accès production SES ou suppression
de branche Neon dans ce lot. Une tentative de correction des métadonnées SES a
été refusée par l'API ; ces métadonnées restent inchangées.

## Corrections implémentées

### Postmark : ne pas réémettre un envoi incertain

- Les réponses HTTP 5xx deviennent `ambiguous`, puis `unknown` dans le worker.
  Pas de nouvel envoi automatique, y compris sur une seconde exécution du job.
- HTTP 429 reste rejouable ; les refus 4xx restent définitifs.
- Les erreurs réseau, réponses invalides, identifiants invalides et dates non
  exploitables ne constituent pas une preuve d'acceptation.
- Les erreurs conservées sont des codes/messages techniques contrôlés. Le texte
  libre de Postmark ou d'une exception réseau n'entre plus dans ces diagnostics.
- Les redirections HTTP sont refusées, pour ne pas transmettre le token ailleurs.

Les régressions ont été reproduites avant correction : trois tests échouaient.
Un test d'intégration utilise ensuite le véritable adaptateur avec une réponse
HTTP 500 simulée, la vraie base locale et le worker : deux exécutions, un seul
appel HTTP, état `unknown`, réservation libérée et aucun débit au ledger.
Ce n'est pas un nouvel envoi réel chez Postmark.

Référence : [contrat des erreurs Postmark](https://postmarkapp.com/developer/api/overview).
Une erreur 500 ne prouve pas l'absence d'acceptation. Classer également les autres
5xx comme incertains privilégie l'absence de doublon à une relance automatique.

### Conservation : entretien indépendant de la veille

- Seules les règles `AttachmentPurgeSchedule` et `RetentionPurgeSchedule` restent
  actives en standby. Les règles métier, sources SQS d'envoi et gates restent fermées.
- Cadence : trente minutes. Une cadence de cinq minutes aurait risqué d'empêcher
  la mise en veille de Neon. Voir [Scale to Zero](https://neon.com/docs/introduction/scale-to-zero).
  La consommation réelle après activation devra être mesurée, pas extrapolée
  depuis la période sans entretien actif.
- Les nouveaux corps de messages expirent deux heures avant le maximum public
  de trente jours. Cela laisse une marge opérationnelle ; ce n'est pas une
  garantie de conservation maximale lors d'une panne durable.
- La purge des données de rétention reçoit un UUID de workspace explicite.
  Sélection et mutation des six catégories sont filtrées par ce workspace.
- Chaque catégorie est limitée à cent lignes par passage, dans une transaction,
  avec `statement_timeout=2s`, `lock_timeout=500ms` et `SKIP LOCKED`.
- La découverte des workspaces est une lecture du registre de contrôle, limitée
  à cinquante identifiants opaques ; elle ne lit pas les données métier globales.
  Les workspaces suspendus ou supprimés logiquement ne sont pas exclus.
- `retention_attempted_at` persiste la rotation. Une erreur avance aussi la date
  de tentative afin de ne pas affamer les autres workspaces ; cette date ne doit
  jamais être interprétée comme une preuve de purge réussie.
- Le worker cesse de commencer de nouveaux workspaces près de sa limite de temps.
  Les erreurs et lots saturés sont signalés par métriques agrégées, sans contenu.
- Le ledger reste conservé ; la suppression conserve le hash anti-réémission.
  Les anciens diagnostics de message sont effacés lors de l'anonymisation à 90 jours.
- Le contrôle `internal-go:audit` vérifie maintenant les corps expirés, les anciens
  messages non anonymisés et les pièces jointes expirées non supprimées, toujours
  sur le workspace explicite. Un arriéré empêche le feu vert interne.

Capacité : il s'agit d'un entretien borné, pas d'une certification à charge
illimitée. Un lot saturé doit déclencher une investigation et un drainage borné.
Avant d'augmenter le nombre de workspaces ou de vendre des volumes importants,
mesurer les temps SQL et le retard réel, puis dimensionner lots/index/cadence.
Le worker de pièces jointes n'a pas été entièrement refondu : son parcours S3,
son débit, sa reprise et sa confirmation réelle restent à certifier.

### Surveillance et permissions

Sept alarmes de maintenance existent en production, y compris standby :
deux erreurs d'invocation EventBridge, deux erreurs Lambda, échecs de purge,
saturation/interruption de lot et absence de heartbeat de rétention sur une heure.
Les actions pointent vers le topic d'exploitation existant. Leur existence dans
le template ne prouve pas la livraison des notifications : test SNS requis.

La permission `ses:GetEmailIdentity` de DomainHealth est limitée aux identités
du compte et de la région du workload, au lieu de `Resource: *`.

### Fiabilité des contrôles locaux

La suite Vitest par défaut désactive le parallélisme entre fichiers : les
synthèses CDK qui compilent les vrais workers ne se concurrencent plus pour le
même budget de cinq secondes. Aucune assertion n'a été supprimée et aucun délai
global n'a été augmenté pour masquer les erreurs.

## Migration et ordre de publication

### Preuves locales

- `npm run check` : lint, TypeScript, **304 tests / 45 fichiers** et build Next.js verts.
- `npm run test:coverage:full` : suite unitaire et PostgreSQL locale verte après
  correction de l'assertion CDK ; lignes 74,57 %, branches 66,87 %. Le dernier
  test ajouté sur le périmètre IAM est également vert dans `npm run check`.
- Migration Drizzle appliquée sur les deux bases jetables locales, jamais en production.
- Neuf tests de rétention : isolation A/B, bornes, expiration, reprise,
  concurrence, rotation, échec contrôlé, validation des entrées et compteurs du GO.
- Parcours publics : **8/8**, avec un worker ; parcours authentifiés : **8/8**.
  Un premier passage public sous concurrence a expiré sur la navigation privée ;
  le même scénario ciblé puis les huit parcours séquentiels sont verts.
- Vérification navigateur de l'accueil et de la connexion : contenu présent,
  contrôles visibles, aucune fenêtre d'erreur du framework.
- `npm audit --audit-level=high` : **0 vulnérabilité** remontée.
- `npx drizzle-kit check` : cohérence des migrations verte.
- Synthèse CDK stricte des trois stacks applicatives : verte, sans déploiement.
- Contrôle de conformité principal : **non vert**, détaillé ci-dessous.

La [PR #50](https://github.com/YoannDrx/yodev-mail/pull/50) reste en brouillon.
La [CI 34962727373](https://github.com/YoannDrx/yodev-mail/actions/runs/34962727373)
est entièrement verte sur le commit de code `73f3e496350e1dc6a09557db9169eab1df22cb1c` :
qualité, secrets, intégration PostgreSQL (**439 tests / 57 fichiers**), huit parcours
publics et huit parcours authentifiés. GitGuardian et le déploiement Vercel de
prévisualisation sont également verts ; aucune publication en production.
Ces contrôles ne prouvent pas
une livraison réelle SES/Postmark, une alerte SNS reçue ni un paiement réel Stripe.

Migration additive `0010_retention_fair_sweep` : une colonne nullable et un index
sur le registre des workspaces. Aucune donnée existante n'est supprimée par la
migration. Les purges seront exécutées uniquement par les workers après activation.

1. AWS est reconnecté et ses gates relus ; reconnecter Stripe puis compléter
   le contrôle des files et du drift. Ne pas réutiliser une ancienne preuve verte.
2. Valider la capacité de sauvegarde/reprise Neon. Les dix branches existantes
   restent conservées ; ne pas en supprimer une arbitrairement pour faire de la place.
3. Sauvegarde/préflight, puis migration Drizzle versionnée avant toute publication
   du nouveau code applicatif : les lectures ORM peuvent sélectionner la nouvelle colonne.
4. CI verte et revue du diff ; publier application et workers en standby. Le diff
   attendu n'ouvre que les deux règles de maintenance et ajoute leurs alarmes.
5. Vérifier exécution réelle, erreurs SQL, heartbeat, SNS et compteur de contenus
   expirés du workspace interne. Réconcilier l'arriéré constaté dans l'audit.
6. Vérifier de nouveau à la prochaine échéance ; mesurer compute Neon et temps SQL.

Rollback : conserver la colonne additive et revenir au code précédent si besoin.
Ne pas supprimer/recréer des ressources stateful. Un retour au template précédent
désactiverait la maintenance en standby : prévoir une procédure d'entretien contrôlée.
Une suppression de contenu déjà effectuée par la politique de rétention n'est pas
réversible par un rollback de code.

## Contrôle AWS supplémentaire : non certifié

Un contrôle `AwsSolutionsChecks` a été exécuté sur Foundation et le workload prod
standby synthétiques, et pas seulement sur le compte de test. Il n'est **pas vert**.
Il signale notamment les familles IAM4/IAM5 (rôle de logs géré et wildcards), S1
(journaux d'accès S3) et L1 (runtime différent du dernier recommandé).

Ces résultats ne prouvent pas une compromission : certaines permissions à motif
sont nécessaires aux ressources multi-tenant et doivent recevoir une justification
précise ; d'autres peuvent être resserrées. La lecture globale DomainHealth a été
resserrée dans ce lot. Aucun contournement global de conformité n'a été ajouté.
La vérification `cdk-nag` verte du compte de test ne certifie pas ces workloads.
La levée de chaque constat principal doit précéder leur certification de conformité.

## Contrôles externes frais après reconnexion

### AWS SES et infrastructure

Contrôles du 15 septembre 2026, compte `274319534967`, région `eu-west-3`,
avec le rôle SSO existant `YoDevMailAdministrator`, sans root ni nouvelle clé statique :

- SES : `ProductionAccessEnabled=false`, `SendingEnabled=true`,
  `EnforcementStatus=HEALTHY`, quota sandbox 200 messages/jour et 1/seconde,
  aucun envoi sur les dernières 24 heures. `SendingEnabled=true` ne lève pas
  les restrictions du sandbox ni les gates applicatifs.
- Suppression de compte active pour `BOUNCE` et `COMPLAINT`.
- `mail.yodev.fr` vérifié ; DKIM activé, `SUCCESS`, RSA 2048 ; MAIL FROM
  `bounce.mail.yodev.fr` en `SUCCESS`, comportement `REJECT_MESSAGE` si échec MX.
- Les détails SES affichent encore `MARKETING`, l'ancienne URL
  `https://vigie-mail.vercel.app` et `ReviewDetails.Status=DENIED`.
- Une unique tentative `PutAccountDetails` pour indiquer le périmètre transactionnel
  actuel et `https://mail.yodev.fr`, en conservant explicitement le sandbox, a échoué
  avec `ConflictException`. La relecture confirme que rien n'a été corrigé.
  La [documentation de l'API](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_PutAccountDetails.html)
  décrit ce conflit lors d'une mise à jour sous examen ; cela ne permet pas de
  déduire qu'un réexamen est en cours lorsque le statut observé reste `DENIED`.
- Dossier Support `178463601800033`, relu dans la console : **Résolu**, bouton
  de réouverture disponible. Dernière réponse AWS le 12 août : refus présenté
  comme définitif. Le message transactionnel du 22 août est bien présent, sans
  nouvelle réponse AWS visible. Aucune nouvelle correspondance envoyée ce jour.
- L'API Support renvoie `SubscriptionRequiredException` avec le plan Basic ;
  la console permet néanmoins de lire le dossier. Aucun abonnement acheté.
- Les 26 workers dev/prod listés restent `standby`, `SES_ENABLED=false`,
  `POSTMARK_ENABLED=false`. Toutes les règles EventBridge prod sont désactivées,
  y compris les deux purges : la correction de ce lot n'est donc pas encore effective.
- Foundation, Dev et Prod sont `UPDATE_COMPLETE`. Ce statut n'est pas un contrôle
  de drift frais et ne certifie pas les constats de conformité restants.

Un domaine vérifié est une brique technique valide, pas une autorisation commerciale.
La prochaine communication AWS doit demander le chemin officiellement supporté
pour corriger le dossier verrouillé, sans répéter une demande identique, contourner
le refus avec un autre compte/région, ni prétendre la chaîne applicative certifiée.

### Neon et Stripe

- Neon : dix branches sur dix, état relu. La production n'est pas migrée.
  Le guide `neon-postgres:neon-postgres` exige de tester la migration sur une
  branche de production avant de l'appliquer en production.
- Accord spécifique demandé pour supprimer uniquement la branche de test archivée
  `test-pilot-readiness-20260813` (`br-restless-truth-as9zo1i6`), puis créer une
  copie récente. Cette suppression serait définitive. **Aucun accord reçu et
  aucune suppression effectuée** ; main, development et les sauvegardes sont conservés.
- Le connecteur Stripe renvoie toujours `UNAUTHORIZED` / `invalid_grant`.
  L'éligibilité courante du compte YoDevMail n'a donc pas été revalidée. Les
  constats Stripe antérieurs ne sont pas présentés comme des preuves du jour.

## Reste obligatoire pour le GO commercial

| Domaine | Condition de sortie |
| --- | --- |
| Rétention | Migration et déploiement réels, arriéré nul, alarmes reçues et cadence observée |
| AWS SES | État compte/région relu ; binding applicatif SES ; chaîne API-outbox-SQS-Lambda-SES-événements-DB-ledger certifiée en sandbox |
| Autorisation AWS | Dossier transactionnel exact, réexamen sans contournement et accès production explicitement accordé |
| Stripe | Compte éligible, fiscalité confirmée, cycle Checkout-webhook-abonnement-usage-facture certifié |
| Reprise | Restauration de la version finale, intégrité, bascule et RTO/RPO mesurés |
| Exploitation | Contrôle principal AWS traité, alertes et DLQ testées, secrets/accès revus, canari actif observé |
| Commercial | Périmètre vendu réellement certifié ; mentions, TVA, conditions et support validés par le responsable |

L'accord AWS est une décision externe. Ni ce code ni un dossier correctement
rédigé ne permettent de promettre l'acceptation ou une délivrabilité à 100 %.
