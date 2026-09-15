# YoDevMail - implémentation du 15 septembre 2026

## État et périmètre

Lot intégré par la [PR #50](https://github.com/YoannDrx/yodev-mail/pull/50), commit
`17ee1576e88059e4959066beddc8176d0801bf8d`, le 15 septembre à 12:12:19 UTC.
**Migration 0010 appliquée sur Neon main ; application, fondation et workers AWS
prod publiés ; arriéré de contenus expirés résorbé.
Le NO-GO commercial reste en vigueur.**
Ce document complète l'[audit du jour](production-readiness-audit-2026-09-15.md),
sans transformer les constats externes datés en validations nouvelles.

L'accès AWS SSO, initialement expiré, a été rétabli pendant cette intervention.
Stripe reste à reconnecter. Les contrôles AWS frais sont consignés ci-dessous.
Après autorisation explicite, une ancienne branche Neon de test a été supprimée,
la migration répétée sur un clone récent puis appliquée à main après snapshot.
Aucune modification de droits pilote, activation d'envoi, paiement ou nouvelle
demande d'accès production SES. Une tentative de correction des
métadonnées SES a été refusée par l'API ; un dossier administratif lié demande
maintenant à AWS le chemin supporté pour les corriger, sans lever le sandbox.

## Résultat de publication vérifié

- Vercel production `dpl_BW6LEXHinaTTwg4CPDi1zMLGeaSC`, `READY` depuis
  12:13:04 UTC, commit `17ee157`, build environ 41 secondes, Next.js/Node 24.
  `mail.yodev.fr/api/health` et `api.mail.yodev.fr/health` : HTTP 200,
  `status=ok`, `database=ok`, version `17ee157`. Le placement retourné reste `iad1`.
- Scan des logs `error`/`fatal` de ce déploiement depuis READY : aucun résultat
  au contrôle initial. Ce n'est pas une observation de 72 h ni une preuve de
  collecte exhaustive ; les drains externes n'ont pas été revalidés dans ce lot.
- Foundation `UPDATE_COMPLETE` à 12:12:55 UTC ; Prod `UPDATE_COMPLETE` à 12:14:48 UTC.
  Changesets préparés puis exécutés séparément, sans hotswap. Aucun remplacement
  de données, clés, files ou rôles. Les seuls remplacements conditionnels signalés
  concernaient les références des permissions Lambda et les métadonnées CDK.
- Après déploiement, drift Foundation et Prod : `IN_SYNC`, zéro ressource en dérive.
  Treize workers prod Node 24, tous `standby`, SES/Postmark désactivés ; seules
  les règles AttachmentPurge et RetentionPurge sont actives, toutes les 30 minutes.
  Dev reste sur son déploiement précédent, sans nouvelle maintenance activée.
- Le paramètre runtime DB prod est un SecureString et pointe bien vers main Neon
  migrée, comparaison effectuée en mémoire sans afficher de connexion/secrets.
- Invocation réelle du worker de rétention : HTTP 200, un workspace traité,
  zéro échec, zéro saturation. Deux passages réussis sont visibles dans les logs,
  avec heartbeat et métriques d'échec/retard à zéro ; durées environ 470 et 222 ms.
  EventBridge rapporte une invocation planifiée à 12:14 UTC.
- Worker de pièces jointes : invocation HTTP 200, zéro objet expiré à traiter,
  environ 384 ms. Cela ne prouve pas encore la suppression réelle d'une pièce jointe
  S3 ni une première exécution de sa règle planifiée.
- Contrôle du workspace interne après nettoyage : **3 vers 0 contenus expirés**,
  zéro ancien message non anonymisé et zéro pièce jointe expirée ; **35 acceptations,
  35 lignes de ledger, zéro discordance**, zéro réservation/outbox/callback en attente.
  Les corps périmés ont été effacés conformément à la rétention. Un rollback de code
  ne les rétablit pas ; le snapshot pré-migration est conservé pour la reprise.
- Huit files prod vides. Sept alarmes actives, toutes OK après vérification.
  Test direct SNS reçu dans Gmail à 12:10:16 UTC, puis test contrôlé d'une alarme
  Lambda reçu à **12:17:34 UTC** (`yodev-cloudwatch-20260915-17ee157`). L'état
  a été temporairement forcé avec `SetAlarmState`, sans erreur applicative injectée
  ni modification de seuil/action. Retour automatique à OK observé.
- La [CI main 34967513058](https://github.com/YoannDrx/yodev-mail/actions/runs/34967513058)
  est entièrement verte. `internal-go:audit --baseline --expected-version=17ee157`
  passe santé, rétention, cohérence DB, files et alarmes. Il reste `NOT_READY` :
  le transport est volontairement en veille, zéro consommateur actif sur quatre.

Limites restantes : répétition de cadence/consommation Neon, livraison effective
des journaux d'accès S3, test complet des pièces jointes, transport SES applicatif,
droits commerciaux AWS, Stripe, restauration/bascule mesurée et observation active.

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
le template ne prouve pas la livraison des notifications. Les tests réels SNS puis
CloudWatch vers Gmail ont réussi ; la cadence durable et les scénarios de panne
réelle restent à exercer.

La permission `ses:GetEmailIdentity` de DomainHealth est limitée aux identités
du compte et de la région du workload, au lieu de `Resource: *`.

### Fiabilité des contrôles locaux

La suite Vitest par défaut désactive le parallélisme entre fichiers : les
synthèses CDK qui compilent les vrais workers ne se concurrencent plus pour le
même budget de cinq secondes. Aucune assertion n'a été supprimée et aucun délai
global n'a été augmenté pour masquer les erreurs.

## Migration et ordre de publication

### Preuves locales

- `npm run check` : lint, TypeScript, **308 tests / 45 fichiers** et build Next.js verts,
  y compris après le renforcement de la politique de livraison des journaux S3.
- `npm run test:coverage:full` : suite unitaire et PostgreSQL locale verte après
  correction de l'assertion CDK ; lignes 74,57 %, branches 66,87 %. Le dernier
  test ajouté sur le périmètre IAM est également vert dans `npm run check`.
- Migration Drizzle appliquée sur les bases jetables locales, puis sur le clone
  récent et main Neon après vérification des hashes du journal et snapshot.
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
- Contrôle de conformité principal Foundation/Dev/Prod : **vert** après corrections,
  avant déploiement ; détail et limites ci-dessous.

La [PR #50](https://github.com/YoannDrx/yodev-mail/pull/50) est fusionnée.
La [CI 34962727373](https://github.com/YoannDrx/yodev-mail/actions/runs/34962727373)
est entièrement verte sur le commit de code `73f3e496350e1dc6a09557db9169eab1df22cb1c` :
qualité, secrets, intégration PostgreSQL (**439 tests / 57 fichiers**), huit parcours
publics et huit parcours authentifiés. GitGuardian et le déploiement Vercel de
prévisualisation sont également verts. Ces preuves sont antérieures au dernier lot IAM.
La [CI finale 34967184199](https://github.com/YoannDrx/yodev-mail/actions/runs/34967184199)
du commit `5309af6` est entièrement verte : **443 tests / 57 fichiers**, **8 parcours
publics + 8 authentifiés**, qualité, secrets, GitGuardian et preview Vercel.
Un premier passage CI a exposé un compte non résolu dans les exceptions IAM du
runner sans AWS ; la synthèse CI utilise désormais le compte fictif explicite
`123456789012`, sans credential production et sans désactiver le contrôle.
Ces contrôles ne prouvent pas une livraison réelle SES/Postmark ni un paiement Stripe.

Migration additive `0010_retention_fair_sweep` : une colonne nullable et un index
sur le registre des workspaces. Aucune donnée existante n'est supprimée par la
migration. Les purges seront exécutées uniquement par les workers après activation.

1. AWS est reconnecté et ses gates relus. Drift Foundation/Prod relu le 15 septembre
   vers 11:45 UTC : `IN_SYNC`, zéro ressource en dérive. Stripe reste à reconnecter.
2. Branche archivée explicitement autorisée supprimée ; clone récent testé et
   snapshot pré-migration créé. Les autres branches et sauvegardes sont conservées.
3. Migration Drizzle 0010 appliquée sur main : journal 10 vers 11, colonne/index
   présents, 39 messages et 35 lignes de ledger inchangés sur le workspace interne.
4. CI finale verte et diff revu ; application/Foundation/Prod publiés en standby. Le diff
   ne retire aucune ressource existante, ouvre seulement les deux règles de
   maintenance et ajoute sept alarmes. Il resserre aussi IAM, ajoute les destinations
   de logs S3 et met les treize workers prod à Node 24 avec SDK embarqué.
   Dev n'est pas publié avant sa propre prévalidation/migration.
5. Exécution réelle, heartbeat, SNS et arriéré du workspace interne vérifiés :
   trois contenus expirés effacés, invariants conservés. Tests S3 complets restants.
6. Vérifier de nouveau à la prochaine échéance ; mesurer compute Neon et temps SQL.

Rollback : conserver la colonne additive et revenir au code précédent si besoin.
Ne pas supprimer/recréer des ressources stateful. Un retour au template précédent
désactiverait la maintenance en standby : prévoir une procédure d'entretien contrôlée.
Une suppression de contenu déjà effectuée par la politique de rétention n'est pas
réversible par un rollback de code.

## Contrôle AWS supplémentaire : code conforme, exploitation à valider

Le contrôle réel `AwsSolutionsChecks` v3 est maintenant exécuté explicitement par
`infra/app.ts` sur Foundation/Dev/Prod ; un rapport plugin vide n'est pas considéré
comme une preuve. La validation complète retourne `success=true`, sans violation.

- Les treize rôles workers gardent leur identité, mais perdent la politique de
  logs gérée globale : deux actions exactes, uniquement leur propre log group.
- Les actions S3/KMS des politiques IAM ont été énumérées. Le rôle GuardDuty suit
  les opérations de scan/validation documentées ; PUT limité à l'objet de validation.
- Les buckets CloudTrail et pièces jointes envoient leurs journaux vers des
  destinations privées distinctes, SSE-S3, rétention 90 jours, conservées au retrait
  de stack. Livraison par service S3 avec SourceArn/SourceAccount ; ACL désactivées.
- Node 24 stable et SDK AWS embarqué depuis le lockfile ; exécution Lambda réelle
  vérifiée sur les deux workers de maintenance après publication. Les autres
  workers restent désactivés et leur certification d'intégration est distincte.
- Les exceptions IAM5 concernent uniquement des motifs de ressources justifiés
  (objets du bucket, paramètres/identités/tenants par environnement, règle GuardDuty
  gérée). Aucune exception globale d'action IAM. Un test injecte `ses:*` dans un rôle
  déjà revu et exige que la conformité échoue.
- Seules les destinations finales de logs reçoivent une exception S1, pour éviter
  une journalisation récursive. Le compte AWS partagé reste une limite d'isolation.

Ce contrôle statique ne remplace pas la preuve d'exécution, la réception des alertes,
une revue exhaustive de toutes les politiques de ressources ni un pentest.

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
- Ancien dossier Support `178463601800033` : refus définitif du 12 août, clarification
  transactionnelle du 22 août sans réponse nouvelle. Le bouton de réouverture
  affiche finalement une fermeture permanente après 14 jours et propose un dossier lié.
- Dossier lié **`178947292100605`** envoyé le 15 septembre à **11:48:42 UTC** :
  `SES account details locked after closed case - metadata correction only`.
  Demande administrative pour corriger MARKETING/ancienne URL après ConflictException,
  en conservant le sandbox. Le refus précédent est explicitement reconnu ; aucune
  hausse de quota, exception ou nouvelle demande d'accès production. Envoi vérifié
  dans la correspondance ; réponse AWS encore attendue.
- L'API Support renvoie `SubscriptionRequiredException` avec le plan Basic ;
  la console permet néanmoins de lire le dossier. Aucun abonnement acheté.
- Les transports dev/prod restent en standby, `SES_ENABLED=false`,
  `POSTMARK_ENABLED=false`. Après publication, les deux règles de purge prod sont
  actives ; les huit autres règles prod restent désactivées.
- Foundation, Dev et Prod sont `UPDATE_COMPLETE`. Drift frais Foundation/Prod :
  `DETECTION_COMPLETE`, `IN_SYNC`, zéro ressource en dérive avant et après publication.

Un domaine vérifié est une brique technique valide, pas une autorisation commerciale.
La communication AWS demande le chemin officiellement supporté pour corriger le
dossier verrouillé, sans contourner le refus par un autre compte/région ni prétendre
la chaîne applicative certifiée. La décision d'accès production reste négative.

### Neon et Stripe

- Projet Neon `round-star-39482619`. Autorisation utilisateur reçue : seule la
  branche archivée `test-pilot-readiness-20260813` (`br-restless-truth-as9zo1i6`)
  a été supprimée, puis son absence vérifiée. Suppression définitive.
- Clone récent de main : `codex-retention-0010-rehearsal-20260915`
  (`br-still-cloud-asdgw723`, parent LSN `0/3DBEA10`), compute 0,25 CU,
  suspension par défaut. Une tentative de paramétrage explicite de suspension a
  été refusée par le forfait ; aucun changement de forfait effectué.
- Répétition Drizzle réussie : hashes/horodatages des dix migrations préexistantes
  conformes, puis journal à onze entrées ; diff de schéma limité à la colonne
  nullable `retention_attempted_at` et l'index `workspaces_retention_idx`.
- Snapshot préproduction `snap-aged-truth-aseb4ly7`, nommé
  `backup-pre-retention-0010-prod-20260915`, créé à 11:47:42 UTC puis relu.
- Main `br-sweet-haze-aso0rivg` migrée avec le même mécanisme Drizzle : onze migrations,
  colonne/index présents. Les 39 messages et 35 lignes du ledger du workspace
  interne restent inchangés. Aucune purge n'a été déclenchée par la migration.
- Dix branches à nouveau, dont le clone conservé. `.env.local` et les connexions
  applicatives n'ont pas changé. La répétition de migration et le snapshot ne
  constituent pas encore un exercice complet de restauration/bascule mesuré.
- Le connecteur Stripe renvoie toujours `UNAUTHORIZED` / `invalid_grant`.
  L'éligibilité courante du compte YoDevMail n'a donc pas été revalidée. Les
  constats Stripe antérieurs ne sont pas présentés comme des preuves du jour.

## Reste obligatoire pour le GO commercial

| Domaine | Condition de sortie |
| --- | --- |
| Rétention | Migration/déploiement faits, arriéré nul, alertes reçues ; cadence durable et pièces jointes à certifier |
| AWS SES | État compte/région relu ; binding applicatif SES ; chaîne API-outbox-SQS-Lambda-SES-événements-DB-ledger certifiée en sandbox |
| Autorisation AWS | Dossier transactionnel exact, réexamen sans contournement et accès production explicitement accordé |
| Stripe | Compte éligible, fiscalité confirmée, cycle Checkout-webhook-abonnement-usage-facture certifié |
| Reprise | Restauration de la version finale, intégrité, bascule et RTO/RPO mesurés |
| Exploitation | Contrôle principal AWS traité, alertes et DLQ testées, secrets/accès revus, canari actif observé |
| Commercial | Périmètre vendu réellement certifié ; mentions, TVA, conditions et support validés par le responsable |

L'accord AWS est une décision externe. Ni ce code ni un dossier correctement
rédigé ne permettent de promettre l'acceptation ou une délivrabilité à 100 %.
