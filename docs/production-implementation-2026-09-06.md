# YoDevMail - objectif de mise en production

Objectif demandé le 6 septembre 2026 : corriger et implémenter les éléments de l'audit, vérifier leur comportement et préparer l'ouverture commerciale sans confondre code disponible et autorisations externes. **Objectif en cours ; aucun GO commercial à ce stade.**

## Lot technique en cours

- Ordonnancement des contrôles de domaines par dernière vérification, les domaines jamais contrôlés en premier ; les échecs avancent aussi dans la rotation.
- Passage explicite du workspace au contrôle d'un binding ; refus inter-workspace et protection contre la réactivation d'un binding désactivé pendant une requête.
- Contrôles SES et DNS bornés, conservation d'une marge avant expiration Lambda, conservation du résultat DMARC.
- Erreur opérationnelle fixe, sans persistance ni propagation du texte brut renvoyé par le fournisseur pour ces contrôles.
- Réconciliation de la destination SES `yodev-mail-eventbridge` déjà existante ; permission d'actualisation limitée aux configuration sets transactionnels `ym-*-txn` du compte et de la région.
- Audit interne limité à un workspace obligatoire ; contrôle message par message du ledger, et non simple égalité de totaux ; détection explicite du transport en veille et de l'accès production SES si activé.
- Aucun changement de schéma, aucun envoi client, aucun paiement et aucune ouverture de gate dans ce lot.

Premières preuves : défaut de réconciliation SES reproduit par deux tests en échec avant correction, puis cinq tests SES réussis. Les quatre premiers tests PostgreSQL sur la rotation de 55 domaines, l'isolation et les erreurs passent. Des tests additionnels couvrent le budget Lambda, le timeout DNS et une erreur de ledger masquée par des totaux égaux. La suite complète et la CI restent à terminer ; un premier essai complet a passé 191 tests applicatifs mais atteint le délai du montage CDK. Les assertions d'infrastructure ne sont pas supprimées ; la tolérance du montage à froid est augmentée.

Audit réel du workspace interne après renforcement : application/API `ffbeed0` et DB OK ; 35 acceptations, 35 lignes de ledger, zéro divergence d'identifiant, zéro réservation, zéro message ambigu, zéro outbox en attente ; huit files Production vides. Résultat **NOT_READY** car transport `standby`, zéro consommateur actif sur quatre. L'unique alarme retournée ne certifie pas une supervision complète du transport.

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

1. Terminer la vérification et publier le lot technique avec les protections de branche existantes.
2. Compléter la certification SES dans un périmètre isolé ; configuration, cas négatifs, retours d'événements et comptabilisation. L'approbation production reste une décision AWS.
3. Certifier la facturation sur le compte/sandbox dédié, préparer le catalogue Live, les webhooks et le portail, puis vérifier le régime fiscal avec le propriétaire avant ouverture.
4. Exécuter un exercice de restauration isolé, documenter temps de reprise et perte acceptable, valider alertes et reprise/DLQ.
5. Certifier les parcours authentifiés à deux workspaces, invitations, rôles et révocations ; certifier les pièces jointes si incluses dans l'offre, sinon les conserver fermées.
6. Réactiver le transport de façon coordonnée uniquement après satisfaction des critères, puis observer les canaris contrôlés pendant 72 heures. Aucun suivi récurrent n'est créé par ce document.

Le conteneur PostgreSQL local `yodev-mail-certification-20260906` est dédié aux données synthétiques de cette certification, accessible uniquement sur `127.0.0.1:55441`. Les dix migrations existantes y ont été appliquées ; ce n'est pas une migration de production.
