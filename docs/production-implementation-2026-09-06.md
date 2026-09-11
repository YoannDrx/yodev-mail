# YoDevMail - objectif de mise en production

Objectif demandé le 6 septembre 2026 : corriger et implémenter les éléments de l'audit, vérifier leur comportement et préparer l'ouverture commerciale sans confondre code disponible et autorisations externes. **Objectif en cours ; aucun GO commercial à ce stade.**

## Premier lot technique publié

- Ordonnancement des contrôles de domaines par dernière vérification, les domaines jamais contrôlés en premier ; les échecs avancent aussi dans la rotation.
- Passage explicite du workspace au contrôle d'un binding ; refus inter-workspace et protection contre la réactivation d'un binding désactivé pendant une requête.
- Contrôles SES et DNS bornés, conservation d'une marge avant expiration Lambda, conservation du résultat DMARC.
- Erreur opérationnelle fixe, sans persistance ni propagation du texte brut renvoyé par le fournisseur pour ces contrôles.
- Réconciliation de la destination SES `yodev-mail-eventbridge` déjà existante ; permission d'actualisation limitée aux configuration sets transactionnels `ym-*-txn` du compte et de la région.
- Audit interne limité à un workspace obligatoire ; contrôle message par message du ledger, et non simple égalité de totaux ; détection explicite du transport en veille et de l'accès production SES si activé.
- Aucun changement de schéma, aucun envoi client, aucun paiement et aucune ouverture de gate dans ce lot.

Preuves : défaut de réconciliation SES reproduit par deux tests en échec avant correction, puis cinq tests SES réussis. Les tests PostgreSQL couvrent la rotation de 55 domaines, l'isolation, les erreurs, le budget Lambda et une erreur de ledger masquée par des totaux égaux. Le timeout DNS a aussi son test de régression. `npm run check` réussit avec 145 tests unitaires/infrastructure, lint, types et build ; 64 tests d'intégration PostgreSQL et huit scénarios Playwright publics réussissent séparément. La [CI 34060705887](https://github.com/YoannDrx/yodev-mail/actions/runs/34060705887) passe intégralement, dont 209 tests unitaires/intégration et huit scénarios navigateur. Couverture : 83,96 % des lignes, 71,24 % des branches. Deux essais locaux de couverture complète ont dépassé le délai de montage CDK sur la machine chargée ; les assertions d'infrastructure ont ensuite toutes passé localement et en CI, sans être supprimées.

Publication : [PR #36](https://github.com/YoannDrx/yodev-mail/pull/36) fusionnée le 6 septembre à 21:24:05 UTC, commit `98b8a78af8b80d2544bcc34522cf72d0d904b173`. Vercel Production `dpl_4UsPiGprGkQDmjNAbEYi3zV8Bkhf` est `READY` ; construction observée environ 30 secondes. Les deux health checks application/API répondent `status=ok`, `database=ok`, `version=98b8a78`. Aucun événement `error` ou `fatal` retourné pour ce déploiement lors du scan post-publication à plus de 60 secondes après READY ; fenêtre réelle encore courte et sans validation sous charge.

AWS Dev : `UPDATE_COMPLETE` à 21:25:04 UTC. AWS Prod : `UPDATE_COMPLETE` à 21:26:04 UTC. Seuls deux workers et leur permission SES ciblée ont changé dans chaque stack. La fondation, les données et les ressources de stockage n'ont pas été redéployées/remplacées. Les 26 workers Dev/Prod sont toujours en standby avec SES/Postmark fermés ; aucun mapping SQS actif. Ces dernières preuves de publication sont ajoutées localement après la fusion, sans redéploiement supplémentaire pour une modification documentaire.

Audit réel du workspace interne après renforcement, avant publication web : application/API `ffbeed0` et DB OK ; 35 acceptations, 35 lignes de ledger, zéro divergence d'identifiant, zéro réservation, zéro message ambigu, zéro outbox en attente ; huit files Production vides. Résultat **NOT_READY** car transport `standby`, zéro consommateur actif sur quatre. Après correction du filtre d'alarmes, zéro alarme du workload Production : l'alarme générale de fondation n'est plus confondue avec sa supervision.

## Dépendances externes revérifiées

### Mise à jour technique du 7 septembre : provisioning

Le [lot #38](https://github.com/YoannDrx/yodev-mail/pull/38) est publié sur Vercel
et AWS Dev/Prod, sous gates fermées, commit `86cb30a`. Il transmet explicitement
le workspace dans les jobs, préserve les suspensions/désactivations et les états
déjà provisionnés, assainit les erreurs fournisseur et empêche le contrôle DNS
avant la disponibilité de l'identité externe. `npm run check` local passe avec
167 tests ; 255 tests de couverture complète passent ; CI de PR et main vertes,
dont huit parcours publics et huit authentifiés. Les
[preuves et limites](provider-provisioning-certification-2026-09-07.md) incluent
les préconditions de bascule SQS et les travaux Postmark encore ouverts : identité
stable du serveur, pagination, reprise après échec partiel, vérification webhook,
créations concurrentes et budget global de provisioning. Ce lot ne clôt pas ces
travaux et ne vaut pas GO commercial.

La suite [reprise Postmark du 7 septembre](postmark-recovery-certification-2026-09-07.md),
publiée par la [PR #39](https://github.com/YoannDrx/yodev-mail/pull/39), commit
`bc8a9e0`, implémente l'identité stable, la pagination, les checkpoints durables, la
vérification webhook, la sérialisation par workspace et le budget commun des
appels externes. Sa certification locale ne remplace pas la vérification réelle
du fournisseur ni la réconciliation opérateur des créations incertaines. Voir
ce compte rendu pour son état de publication et ses preuves propres.
288 tests de couverture complète passent ; `npm run check`, les huit parcours
publics locaux et les huit parcours authentifiés en CI sont verts. Vercel READY
et AWS Dev/Prod UPDATE_COMPLETE, avec les 26 workers toujours en standby et les
files de provisioning vides. Aucun secret, webhook réel ou schéma n'est modifié.

### Mise à jour technique du 7 septembre : événements fournisseur

Le [lot d'ingestion des événements](provider-event-certification-2026-09-07.md)
rend la suspension de réputation atomique avec la plainte, les compteurs et son
audit. Il refuse les identifiants fournisseur contradictoires et protège les
simulations test. Trois défauts reproduits avant correction ; dix nouveaux
scénarios PostgreSQL, 298 tests globaux et `npm run check` verts localement.
Publié dans la PR #40, commit `192ddabd56b43b2f5d1f4ea335293ae14f2d0094` :
CI de PR et de `main` vertes, Vercel READY, AWS Dev/Prod UPDATE_COMPLETE.
Les 26 workers restent en standby, les files d'événements et DLQ sont vides.
La lecture de l'historique interne ne justifie aucune réparation de suspension.
Les preuves sont suivies dans le compte rendu dédié. Cette certification DB
ne remplace pas le transport SES réel de bout en bout ; l'accès production
SES reste `DENIED` lors de la nouvelle lecture.

### Mise à jour technique du 7 septembre : contrat des callbacks et files

Le [lot de validation des événements](provider-event-contract-2026-09-07.md)
ajoute des validations runtime aux entrées SES/Postmark, impose leur date réelle,
filtre les diagnostics libres avant publication et signale les messages SQS
malformés pour reprise au lieu de les acquitter silencieusement. 22 nouveaux
tests unitaires et un scénario de route authentifiée sont ajoutés. Publié dans
la PR #41, commit `d8c717d2ae245eb64cf4db563c5eff46f6526017` : 321 tests
en CI, CI de PR et de main vertes, Vercel READY, AWS Dev/Prod UPDATE_COMPLETE.
Le health répond sur cette version ; les 26 workers restent en standby.
Les preuves et limites sont détaillées dans le rapport.

### Mise à jour technique du 7 septembre : isolation des événements SES

Le [lot d'isolation Dev/Prod](ses-environment-isolation-2026-09-07.md) corrige
un filtre réellement commun aux deux règles déployées : test AWS reproduit,
règles actuellement désactivées. Le tag d'environnement est imposé à l'envoi,
filtré par EventBridge et revérifié par le consommateur. 332 tests, les huit
parcours publics et les 16 tests de patterns exécutés par AWS passent.
Publié dans la PR #42, commit `eb9160e6b4a11195264d5b293d639087d5e07d5c` :
CI PR/main vertes, Vercel READY et AWS Dev/Prod UPDATE_COMPLETE. Les 16 cas
repassent sur les règles déployées ; quatre événements mal routés/non tagués
sont refusés lors de deux invocations Lambda synchrones contrôlées. Les règles
et envois restent fermés. Cela ne prouve pas l'isolation complète des
tenants/identités fournisseur ni la chaîne d'envoi réelle.

### Mise à jour technique du 7 septembre : rattachements SES

Le [lot de rattachements SES](ses-resource-bindings-2026-09-07.md) complète
l'isolation des événements par des noms de tenant/configuration Dev/Prod
distincts et un contrôle du compte stocké avant provisionnement et envoi.
L'inventaire du workspace interne est vide pour SES dans les deux branches
Neon ; aucune référence historique n'est migrée implicitement.
Publié dans la PR #43, commit `7436dd392d13ec138ed730be94f12b872e8b5c04` :
353 tests, CI PR/main vertes, huit parcours authentifiés et huit publics.
Vercel READY, health `7436dd3`, AWS Dev/Prod UPDATE_COMPLETE ; 26 workers
toujours en standby. Les permissions IAM et la chaîne d'envoi réelle restent
à certifier séparément ; aucun tenant partagé n'a été modifié.

### Correctif IAM SES certifié sur sonde de test et publié en standby

Le [rapport IAM SES](ses-iam-certification-2026-09-07.md) documente une permission
Dev trop large confirmée par le simulateur AWS et le correctif proposé :
restriction des tenants/configurations par environnement, propriété explicite
des identités et refus applicatif des identités historiques non attribuées.
Le compte de test dédié `764858776290` est désormais configuré avec accès SSO
et journalisation durable. Les 44 contrôles réels de provisioning passent et
les deux identités synthétiques sont vérifiées, DKIM et MAIL FROM `SUCCESS`.
La première politique d'envoi refusait aussi les envois légitimes : un diagnostic
isolé a identifié la condition ResourceTag sur SendEmail. La correction limite
l'envoi par tenant IAM et utilise le contrôle d'association SES ; les tags de
propriété restent requis lors des écritures d'association et MAIL FROM.
Les 12 contrôles réels d'envoi passent après mise à jour des seuls rôles sender
de test : deux acceptations, huit refus IAM, deux refus d'association SES.
La simulation IAM reste divergente (66/76 résultats attendus, dix faux négatifs
par rapport aux attentes IAM, aucun allow inattendu) et n'est pas présentée
comme verte. Les [preuves réelles et limites](ses-real-probe-2026-09-10.md)
distinguent ces contrôles d'une certification de livraison ou du parcours
applicatif complet. PR #44 fusionnée sous `a65f72d`, CI PR/main vertes, Vercel
READY et AWS Dev/Prod UPDATE_COMPLETE. Les quatre politiques SES déployées sont
conformes aux templates. Les 26 workers restent en standby, SES/Postmark fermés,
20 règles EventBridge désactivées et zéro mapping SQS. L'identité historique
reste intacte. Les preuves post-publication sont détaillées dans le rapport
réel ; aucun GO commercial n'est accordé.

### Stripe

Actualisation du 11 septembre : le même compte Live retourne toujours
`charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false` et
`requirements.past_due`. Aucun paiement ni changement de compte effectué.
Les autres objets Stripe cités ci-dessous n'ont pas été relus le 11 septembre.

Le connecteur est à nouveau accessible. Le compte Live sélectionné pour ce produit est `acct_1U6Sh495MZhNiINX` (Mail by Yodev). Les autres comptes ne sont pas modifiés.

Lecture du 6 septembre : `charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false`, `disabled_reason=requirements.past_due`. Les informations d'entreprise, du représentant, du compte bancaire et l'acceptation des conditions sont à compléter par le propriétaire dans Stripe. Aucun tarif Live, aucun endpoint webhook Live et aucune inscription fiscale n'ont été retournés. L'absence d'inscription Stripe Tax ne permet pas de déduire le régime fiscal réel.

L'outil spécialisé de description du compte a renvoyé une erreur de méthode ; la lecture via l'API générique officielle du même connecteur a réussi. Le sandbox historique n'est pas exposé dans la liste actuelle du connecteur. Activation du compte et statut TVA demandés au propriétaire, sans collecte de documents d'identité dans la conversation.

### SES

Les constats de l'audit précédent restent les conditions d'ouverture : approbation AWS nécessaire, binding applicatif SES à certifier et parcours complet d'envoi à rejouer. Ne pas assimiler l'acceptation par le simulateur du 6 septembre à une autorisation commerciale.

### Neon

Projet `round-star-39482619`, branche principale `br-sweet-haze-aso0rivg`, forfait `free_v3`, rétention de six heures, dix branches présentes pour une limite de dix. Aucun exercice ne doit remplacer ou réinitialiser la branche principale. Les anciennes sauvegardes sont conservées. Libérer une branche explicitement choisie ou disposer de capacité supplémentaire est nécessaire avant de créer une nouvelle branche d'exercice. Les branches protégées sont une fonctionnalité de forfait payant selon la [documentation Neon](https://neon.com/docs/guides/protected-branches) ; aucun forfait n'a été acheté.

## Travaux restant à fermer

Le [lot du 11 septembre](queue-workspace-certification-2026-09-11.md) corrige
les contrats des jobs d'envoi et de callbacks : workspace obligatoire et filtré
dès l'accès initial, payload strict, erreur d'outbox assainie et échec partiel
SQS détecté. 411 tests complets et 16 parcours navigateur locaux réussissent.
Ce lot est préparé pour publication coordonnée, pas déployé sur AWS : les
sessions SSO ont expiré. Le rapport détaille aussi Stripe et Neon relus ce jour.

Le lot de [certification authentifiée](authenticated-certification-2026-09-06.md)
est vérifié dans la [PR #37](https://github.com/YoannDrx/yodev-mail/pull/37) : huit
parcours navigateur réels et 13 tests unitaires supplémentaires. Il corrige aussi
la page d'erreur après perte d'accès au workspace ou première connexion avant
acceptation d'une invitation. CI entièrement verte sur `117a5c0` ; le nouveau
contrôle navigateur est obligatoire sur `main`. Les preuves de ce lot ne
remplacent pas les validations fournisseurs ni les conditions commerciales.

1. Premier lot technique vérifié et publié avec les protections de branche existantes. Poursuivre les volets ci-dessous ; ce jalon ne clôt pas l'objectif global.
2. Compléter la certification SES dans un périmètre isolé ; configuration, cas négatifs, retours d'événements et comptabilisation. L'approbation production reste une décision AWS.
3. Certifier la facturation sur le compte/sandbox dédié, préparer le catalogue Live, les webhooks et le portail, puis vérifier le régime fiscal avec le propriétaire avant ouverture.
4. Exécuter un exercice de restauration isolé, documenter temps de reprise et perte acceptable, valider alertes et reprise/DLQ.
5. Certification Chromium locale/CI à deux workspaces, invitations, rôles, révocations et passkeys virtuelles réalisée dans le lot #37. Restent Google OAuth réel, les emails d'authentification et les passkeys physiques/multinavigateurs ; certifier les pièces jointes si incluses dans l'offre, sinon les conserver fermées.
6. Réactiver le transport de façon coordonnée uniquement après satisfaction des critères, puis observer les canaris contrôlés pendant 72 heures. Aucun suivi récurrent n'est créé par ce document.

Le conteneur PostgreSQL local `yodev-mail-certification-20260906` est dédié aux données synthétiques de cette certification, accessible uniquement sur `127.0.0.1:55441`. Les dix migrations existantes y ont été appliquées ; ce n'est pas une migration de production.
