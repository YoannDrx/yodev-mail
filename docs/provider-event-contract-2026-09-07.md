# Certification du contrat des événements fournisseur - 7 septembre 2026

Suite de la PR #40. Ce lot traite les entrées et la reprise SQS, pas
l'approbation commerciale ni la délivrabilité. Les envois restent fermés.

## Défauts reproduits et corrections

Douze des dix-sept premières régressions échouaient avant correction : valeurs
JSON incorrectes susceptibles de lever une exception, dates manquantes ou
invalides acceptées, fournisseur/type arbitraire, identifiants non bornés ou
non conformes, texte libre conservé dans `reasonCode`, callbacks Postmark sans
date acceptés. Le repli sur l'heure courante rendait notamment l'identité de
déduplication instable lorsque la date fournisseur était absente.

- Validation runtime Zod des enveloppes SES/Postmark : fournisseur et type
  reconnus, identifiants techniques bornés, workspace UUID obligatoire dans la
  file, UUID du message s'il est présent, date ISO valide obligatoire.
- Aucun repli sur `Date.now()` pour la normalisation. Sans ID d'événement SES,
  le hash reste déterministe à partir de l'identité fournisseur, du type et de
  la date de l'événement. Un ID interne absent permet toujours la recherche
  fournisseur limitée au workspace ; un ID présent mais invalide est refusé.
- Champs supplémentaires exclus de la sortie ; `reasonCode` réduit à une
  liste fermée de classifications connues. Les diagnostics libres sont omis,
  sans supprimer un événement de sécurité par ailleurs valide. Les formats
  d'identifiants n'autorisent pas les adresses email.
- Validation Postmark avant publication en file, y compris des métadonnées de
  corrélation. Livraison : `DeliveredAt`. Rebond **et plainte** : `BouncedAt`,
  conformément à la documentation fournisseur, y compris sa précision
  fractionnaire. Les autres champs de date ne remplacent pas celui attendu.
- Un enregistrement SQS malformé est signalé dans `batchItemFailures` avec le
  code fixe `invalid_event`, sans accusé de succès silencieux. Une panne DB ou
  JSON invalide reste un échec technique. Les autres éléments du lot continuent.
  Les éléments sans message corrélé sont journalisés `skipped`, pas `completed`.

Le contrat IaC existant active `ReportBatchItemFailures` et une DLQ après le
seuil de cinq réceptions lorsque le transport est activé. Aucun réglage IaC
n'est changé ici. En standby, il n'y a pas de consommation SQS : la reprise et
la DLQ réelles doivent encore être certifiées dans la fenêtre isolée prévue.
Les messages malformés déjà présents exigeraient une analyse opérateur, pas
une purge. Aucun contenu de file réel n'a été lu ou modifié pour ces tests.

## Vérifications

- 22 nouveaux tests unitaires : entrées JSON, dates/identifiants, absence de
  données personnelles, reprise stable, plainte Postmark documentée, lot mixte,
  erreur d'initialisation et résultat sans corrélation.
- Les 31 tests ciblés des trois fichiers de normalisation passent.
- `npm run check` : lint, TypeScript, 210 tests unitaires et build verts.
- Couverture complète : 320 tests, 46 fichiers, 79,50 % des lignes et
  72,22 % des branches ; seuils inchangés. Cette exécution précède le dernier
  test d'intégration de refus de callback ci-dessous.
- Trois tests d'intégration de provisioning/callback passent après cet ajout.
  Le nouveau scénario invoque la vraie route authentifiée avec PostgreSQL
  local : quatre callbacks invalides retournent 400 et aucun n'est mis en file.
  Les transports Postmark/SSM/SQS sont simulés, pas l'authentification de route
  ni les checkpoints DB. Les fixtures utilisent maintenant l'origine réelle
  `mail.yodev.fr` et les dates propres à chaque type fournisseur.

- Les huit parcours navigateur publics passent localement en 42,9 secondes.
  `agent-browser` absent : vérification effectuée par Playwright, sans contrôle
  visuel supplémentaire. Aucune interface n'est modifiée dans ce lot.

La CI et le déploiement de ce lot sont à confirmer
avant de le déclarer publié. Le code commercialement servi reste le commit
`192ddabd56b43b2f5d1f4ea335293ae14f2d0094` tant que cette publication n'est
pas constatée. Aucun secret ni schéma de production n'est modifié.

## Limites restantes

Le validateur ne remplace pas l'authentification des producteurs, la politique
IAM, ni la corrélation DB renforcée dans la PR #40. Le transport SES complet,
l'isolation Dev/Prod des règles EventBridge et les retours réels doivent encore
être certifiés. Les effets historiques et les événements contradictoires ne
sont pas réparés automatiquement. L'ouverture SES, Stripe Live, la restauration
et les 72 heures de supervision restent des conditions distinctes.

## Sources

- [AWS : erreurs SQS et réponses partielles](https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html).
- [AWS : événements SES EventBridge](https://docs.aws.amazon.com/ses/latest/dg/monitoring-eventbridge.html).
- [Postmark : livraison](https://postmarkapp.com/developer/webhooks/delivery-webhook),
  [rebond](https://postmarkapp.com/developer/webhooks/bounce-webhook) et
  [plainte](https://postmarkapp.com/developer/webhooks/spam-complaint-webhook).
