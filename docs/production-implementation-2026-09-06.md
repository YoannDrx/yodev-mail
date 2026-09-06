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

### Stripe

Le connecteur est à nouveau accessible. Le compte Live sélectionné pour ce produit est `acct_1U6Sh495MZhNiINX` (Mail by Yodev). Les autres comptes ne sont pas modifiés.

Lecture du 6 septembre : `charges_enabled=false`, `payouts_enabled=false`, `details_submitted=false`, `disabled_reason=requirements.past_due`. Les informations d'entreprise, du représentant, du compte bancaire et l'acceptation des conditions sont à compléter par le propriétaire dans Stripe. Aucun tarif Live, aucun endpoint webhook Live et aucune inscription fiscale n'ont été retournés. L'absence d'inscription Stripe Tax ne permet pas de déduire le régime fiscal réel.

L'outil spécialisé de description du compte a renvoyé une erreur de méthode ; la lecture via l'API générique officielle du même connecteur a réussi. Le sandbox historique n'est pas exposé dans la liste actuelle du connecteur. Activation du compte et statut TVA demandés au propriétaire, sans collecte de documents d'identité dans la conversation.

### SES

Les constats de l'audit précédent restent les conditions d'ouverture : approbation AWS nécessaire, binding applicatif SES à certifier et parcours complet d'envoi à rejouer. Ne pas assimiler l'acceptation par le simulateur du 6 septembre à une autorisation commerciale.

### Neon

Projet `round-star-39482619`, branche principale `br-sweet-haze-aso0rivg`, forfait `free_v3`, rétention de six heures, dix branches présentes pour une limite de dix. Aucun exercice ne doit remplacer ou réinitialiser la branche principale. Les anciennes sauvegardes sont conservées. Libérer une branche explicitement choisie ou disposer de capacité supplémentaire est nécessaire avant de créer une nouvelle branche d'exercice. Les branches protégées sont une fonctionnalité de forfait payant selon la [documentation Neon](https://neon.com/docs/guides/protected-branches) ; aucun forfait n'a été acheté.

## Travaux restant à fermer

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
