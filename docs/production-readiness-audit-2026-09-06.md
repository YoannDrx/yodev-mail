# YoDevMail - audit de production du 6 septembre 2026

## Décision

**NO-GO commercial. SES fonctionne pour un essai sandbox, mais n'est pas autorisé pour les destinataires clients non vérifiés.** Le service public reste en bêta privée et en veille. Aucun interrupteur commercial n'a été ouvert pendant cet audit.

Il ne s'agit pas d'un score de complétude : les preuves techniques, l'autorisation fournisseur, la capacité opérationnelle et la facturation sont des conditions distinctes. Une compilation réussie ne certifie pas la livraison, l'isolation réelle de deux clients ou un cycle de paiement.

Périmètre : dépôt, tests, Vercel Production, Neon principal, AWS eu-west-3 avec le rôle SSO administrateur existant, identité SES, DNS publics, dossier AWS Support et serveur Postmark lié au workspace interne. Pas de suppression de données, migration de schéma, achat de forfait, message à un client ou changement de région pour contourner AWS.

## Photographie vérifiée en direct

| Domaine | Observation du 6 septembre | Conclusion |
|---|---|---|
| Web/API | `mail.yodev.fr/api/health` et `api.mail.yodev.fr/health` : HTTP 200, application et DB `ok`, version initiale `7f80353` | Accessibles ; pas une preuve d'envoi |
| Vercel | `POSTMARK_ENABLED`, `SES_ENABLED`, `LIVE_EMAIL_ACCEPTANCE_ENABLED`, `COMMERCIAL_ONBOARDING_ENABLED`, `LIVE_CHECKOUT_ENABLED`, `STRIPE_USAGE_REPORTING_ENABLED`, `CUSTOMER_WEBHOOKS_ENABLED`, `ATTACHMENTS_ENABLED`, `RAW_EMAIL_ENABLED` : `false` | Service fermé à l'exploitation commerciale |
| Fiscalité | `STRIPE_TAX_MODE=unconfigured` | Checkout à conserver fermé |
| Neon principal | Projet `yodev-mail-db`, branche principale `br-sweet-haze-aso0rivg`, PostgreSQL 17, dix migrations journalisées | DB accessible et journal cohérent avec `0000` à `0009` ; aucune migration appliquée ici |
| Données internes | 35 messages acceptés, 35 lignes de ledger, zéro réservation restante, zéro `sending`/`unknown`, 149 outbox livrées | Pas d'écart de comptabilisation constaté sur ce workspace |
| Historique des messages | Postmark : 26 `delivered`, 9 `soft_bounced`, 1 `failed`, 3 `simulated` | Ne pas présenter cet historique comme une campagne de certification ou 35 livraisons réussies |
| Abonnement interne | Plan bêta, statut `inactive`, aucun abonnement Stripe, droit pilote jusqu'au 12 septembre 2026 à 12:22 UTC | Le droit pilote n'est pas un abonnement commercial |
| AWS Production | Stack `UPDATE_COMPLETE`, mode `standby`, 13 workers avec fournisseurs désactivés | Aucun consommateur SQS actif au début de l'audit |
| AWS Development | Stack ancienne en standby mais 11 workers avec gates fournisseurs à `true`, sans mappings SQS ; règle de résultat de scan encore active | Configuration incohérente à réaligner sur le code actuel |
| Files AWS | Les 16 files et DLQ Dev/Prod ont zéro message visible, en vol ou différé | Aucun backlog observé |
| Alarmes | Aucune alarme en état `ALARM` ; alarmes applicatives absentes en standby par conception | Ne prouve pas qu'un service actif serait supervisé |
| Pièces jointes | Plan GuardDuty Production `ACTIVE` sur `pending/`, fonctionnalité et règle de traitement Production fermées | Scan réel, blocage et purge à certifier avant ouverture |
| Postmark | Server `20309693`, `Live`, SMTP/raw/tracking désactivés, un token actif ; webhook `25574138` avec authentification et delivery/bounce/complaint vérifiés, contenu exclu | Configuration fournisseur accessible ; pas de nouvel envoi Postmark pendant cet audit |
| Stripe | Connecteur expiré, reconnexion demandée | Compte dédié, catalogue et paiement non revalidés en direct |

Toutes les requêtes sur les données métier de cet audit ont été restreintes au workspace interne `15734662-27a7-4bd8-b4bf-e6caed86a17a`. Les résultats n'incluent ni destinataires, ni contenu, ni secrets. Les paramètres sensibles utilisés pour lire Postmark sont restés dans le processus d'exécution.

### Neon : reset et consommation

Le projet annonce une nouvelle période du **1er septembre au 1er octobre 2026**. La lecture initiale du compteur indiquait **8 790 secondes de compute, soit environ 2,44 CU-heures**, environ 0,21 Mo de transfert et 35,2 Mo de stockage. Ces compteurs évoluent avec les audits. Une branche archivée automatiquement au repos n'est pas une panne : les health checks ont réactivé l'accès normalement.

Le compteur de ce projet ne représente pas la consommation de toutes les applications du compte. Aucune projection financière multi-application fiable n'est fournie ici. La fenêtre de restauration observée est de six heures ; aucune restauration réelle n'a été rejouée pendant cet audit.

## AWS SES : ce qui fonctionne et ce qui bloque

Compte `274319534967`, région `eu-west-3` :

- `ProductionAccessEnabled=false`, `SendingEnabled=true`, enforcement `HEALTHY`.
- Quota sandbox : 200 messages par 24 heures et 1 message/seconde. Le simulateur ne doit pas être confondu avec un trafic client autorisé.
- Identité `mail.yodev.fr` vérifiée ; DKIM `SUCCESS`, signature RSA 2048 ; MAIL FROM `bounce.mail.yodev.fr` `SUCCESS`, échec MX configuré en `REJECT_MESSAGE`.
- SPF public `v=spf1 include:amazonses.com ~all` et MX `10 feedback-smtp.eu-west-3.amazonses.com` présents. **Correction de l'ancien audit : `~all` n'est pas une erreur bloquante ; c'est la valeur publiée dans l'exemple AWS.** Aucun changement DNS inutile n'a été effectué.
- DMARC publié en observation (`p=none`). Ce n'est pas une politique de rejet : surveiller l'alignement de tous les expéditeurs avant un éventuel durcissement.
- Suppression de compte pour BOUNCE et COMPLAINT ; tenant de certification isolé `ym-sandbox-cert`, suppression au niveau tenant, identité et configuration set `ym-sandbox-cert-txn` associés.
- Destination EventBridge de ce configuration set activée pour delivery, bounce, complaint, reject et delivery delay. Les règles applicatives sont désactivées en standby.
- Aucun compte fournisseur SES ni binding SES n'est provisionné dans le workspace applicatif actuel. Vérifier le domaine AWS seul ne crée pas une route d'envoi YoDevMail.

### Décision AWS, non problème de DNS

Le [dossier 178463601800033](https://support.console.aws.amazon.com/support/home#/case/?displayId=178463601800033&language=en) affiche un refus déclaré définitif par AWS le **12 août 2026**. Une correspondance du **22 août** demande déjà de corriger l'ancien cas d'usage marketing/VigieMail vers le produit exclusivement transactionnel. Aucune nouvelle réponse AWS n'est visible après cette correspondance, et le dossier est fermé.

`GetAccount.Details` conserve l'ancien type `MARKETING`, l'ancienne URL et `ReviewDetails.Status=DENIED`. Il ne faut ni promettre une approbation, ni créer un autre compte/région pour contourner ce refus, ni affirmer que modifier le DNS suffirait. Le support doit indiquer si une nouvelle évaluation du produit matériellement différent est possible. Ne pas réexpédier une demande identique déjà soumise.

### Preuve d'envoi du 6 septembre

À **19:46:16 UTC**, le `SesDeliveryProvider` corrigé a envoyé un message sans données client au simulateur officiel de succès, avec le tenant isolé et la configuration transactionnelle existante. SES a retourné :

`011301a07841d7eb-1632cd7b-300d-430e-aa5e-28dcc40d8286-000000`

Cette preuve valide une **acceptation réelle par SES depuis le code**, pas une livraison en boîte Gmail/Outlook/iCloud, ni un parcours API → réservation → SQS → worker → événement → ledger de cette version. Le test n'a créé aucun message applicatif et n'a pas ouvert les gates Vercel/AWS. La certification EventBridge/SQS/Lambda du 21 août reste une preuve historique, non rejouée ici.

## Corrections de cet audit

PR [#35](https://github.com/YoannDrx/yodev-mail/pull/35), branche `codex/ses-production-audit-20260906`.

| Défaut | Risque | Correction / preuve |
|---|---|---|
| SES SDK effectuait trois tentatives sur un timeout | Doublons, car `SendEmail` n'a pas de clé d'idempotence fournisseur | `maxAttempts: 1`, test sur le vrai middleware SDK avec transport remplacé : trois appels avant, un après |
| Requêtes SES non bornées et erreurs 5xx rejouables | Expiration du worker ou nouvelle tentative après acceptation incertaine | Signal d'annulation à 15 secondes ; 5xx/réseau/timeout restent `ambiguous`, sans renvoi automatique |
| Compte suspendu classé transitoire ; erreurs brutes persistables | Réessais inutiles et risque d'adresses/contenu dans les erreurs opérationnelles | Rejets explicites définitifs, throttling transitoire ; noms et messages de diagnostic sur liste autorisée |
| Tous les bounces SES étaient permanents | Suppression durable d'un destinataire après un rebond temporaire | Seul `Permanent` produit `hard_bounced`; `Transient` et type inconnu ne créent pas de suppression permanente |
| Domaine activable malgré MAIL FROM non vérifié | Envois refusés avec la politique `REJECT_MESSAGE` | Exiger identité, DKIM et MAIL FROM vérifiés ensemble |
| ARN du binding reconstruit avec un account ID potentiellement vide | Métadonnée de domaine SES invalide après provisioning Lambda | Réutilisation de l'ARN complet résolu et associé par le provisionnement |
| Rôle Vercel sans `ses:GetEmailIdentity` | Bouton de vérification SES refusé par IAM | Lecture limitée aux identités du compte/région ; aucun `SendEmail` ajouté à Vercel. Simulation IAM avant correction : `implicitDeny` |
| Événement SES daté à l'heure d'envoi initiale | Livraison/plaintes tardives comptées à une date incorrecte | Utiliser l'heure de génération de l'événement EventBridge, pas `mail.timestamp` |
| Dépendances transitives `fast-uri` et `qs` vulnérables | Vulnérabilités connues dans la chaîne de dépendances | Mise à jour du lockfile ; `npm audit` : zéro vulnérabilité connue. Aucune exploitation de l'application démontrée |

Tests locaux : `npm run check` (lint, TypeScript, 140 tests et build) et les 8 tests Playwright publics réussis. Les tests de régression ont d'abord reproduit 23 échecs avant les corrections. La [CI du code `ef2d917`](https://github.com/YoannDrx/yodev-mail/actions/runs/34056238239) est entièrement verte : qualité, navigateur, secrets et **198 tests unitaires/intégration** avec PostgreSQL 17 isolé. Couverture globale mesurée : 83,57 % des lignes et 71,04 % des branches ; ce n'est pas une preuve de couverture exhaustive. Docker local n'était pas démarré ; l'intégration a été exécutée en CI. Les parcours authentifiés réels ne sont pas couverts par les huit tests publics.

### Publication et contrôles d'infrastructure

- Avant publication, `YodevMailFoundation`, `YodevMailDev` et `YodevMailProd` étaient `IN_SYNC`, zéro ressource en dérive. Development était donc conforme à son **ancien** template, pas au code actuel.
- Le `cdk diff` a été examiné avant déploiement. Aucun bucket, clé KMS ou file n'a été supprimé ou remplacé. Les délais de visibilité Dev ont été alignés sur 360/420 secondes et deux workers de récupération/réconciliation déjà présents en Production ont été ajoutés en Dev.
- AWS Dev : `UPDATE_COMPLETE` à **19:55:35 UTC**. Treize workers en `standby`, gates SES/Postmark `false`, dix règles désactivées.
- AWS Prod : `UPDATE_COMPLETE` à **19:57:14 UTC**. Code des treize workers, lecture IAM limitée et horodatage de la règle SES mis à jour ; mode `standby` conservé. Foundation n'a pas été redéployée.
- Simulation IAM après déploiement Production : `ses:GetEmailIdentity=allowed` sur l'identité contrôlée, `ses:SendEmail=implicitDeny` pour Vercel. Seul le worker d'envoi peut envoyer.
- Preview Vercel `dpl_QmBSLon5ebMHvBB7hXRKYW8rN4YF` : `READY`, health application/DB `ok`, version `ef2d917`. La publication web Production suit la fusion contrôlée de la PR #35 et doit être vérifiée par son health check, sans promouvoir les variables Preview en Production.
- Aucune migration, suppression de données, activation d'envoi, ouverture commerciale ou modification de la checklist utilisateur non commitée n'est incluse.

## Conditions restantes pour une commercialisation

### Bloqueurs de lancement

1. **Choisir un transport commercial effectivement autorisé.** Pour SES : obtenir une réponse favorable AWS avant les destinataires non vérifiés, provisionner un vrai binding applicatif, puis certifier toute la chaîne. Si AWS maintient son refus, Postmark reste une option d'exploitation distincte, pas une preuve que SES est prêt.
2. **Facturation dédiée YoDevMail.** Reconnecter Stripe, contrôler test/live et les secrets restreints, vérifier catalogue/prix/portail/webhooks, valider les informations fiscales avec le propriétaire, puis démontrer checkout, facture, compteur d'usage, impayé, résiliation et remboursement. Aucun paiement réel ou forfait payant n'a été déclenché.
3. **Capacité et sécurité du fournisseur.** Vérifier le forfait Postmark courant avant engagement commercial ; l'ancien relevé Developer 100 emails/mois n'est pas un forfait production validé aujourd'hui. Toute clé connue comme exposée doit être révoquée et remplacée avant réactivation ; compter un token actif ne prouve pas sa rotation.
4. **Certification applicative en conditions réelles.** Workspace interne explicitement approuvé, domaine, profil/template, clés test/live, un destinataire possédé par l'équipe, passage API → worker → fournisseur → événement → consultation du message, ledger et quota exactement une fois. Tester un rejet, un bounce permanent, une plainte, un timeout ambigu et les webhooks signés avec un endpoint contrôlé.
5. **Réactivation coordonnée, pas seulement un flag SES.** Modes AWS, mappings SQS, règles/schedules, gates Vercel et supervision doivent correspondre au mode choisi. Contrôler droits pilotes arrivant à échéance, quotas et rollback avant toute acceptation live.

### Preuves de fiabilité à fermer avant clients payants

- Isolation A/B authentifiée, invitation, changement de workspace, rôles, révocation de clé et refus d'un non-membre ; les tests DB ne remplacent pas tous les gestes navigateur.
- Restauration Neon sur une branche isolée, objectifs de perte et de reprise documentés ; revue de la rétention actuelle de six heures et protection de la branche principale.
- Alarmes effectivement actives, destinataires d'alerte confirmés, exercice DLQ et arrêt/reprise sans replay d'envoi ambigu ; observation d'un canari sur 72 heures après activation, pas pendant une veille sans trafic.
- Si les pièces jointes font partie de l'offre : upload, fichier sain/malveillant, blocage avant envoi, accès inter-tenant et purge effective. Conserver la fonctionnalité fermée sinon.
- Preuve de délivrabilité sur plusieurs messageries contrôlées, et processus de traitement des plaintes, suppressions et incidents. Pas de garantie de boîte de réception à 100 %.
- Vérification par le propriétaire des mentions commerciales, TVA, CGV/DPA, engagements de support et de service réellement tenables. L'existence des pages ne constitue pas une validation juridique.

### Limite de montée en charge repérée

`domain-health.ts` sélectionne au plus 50 bindings sans tri équitable ni curseur. Au-delà de 50 bindings éligibles, certains pourraient ne plus être revérifiés. Non bloquant pour l'unique workspace actuel ; ajouter un traitement équitable et sa preuve DB avant de dépasser cette taille. Le provisionnement ignore aussi une destination EventBridge déjà existante sans réconcilier sa configuration : l'audit a vérifié la destination isolée actuelle, mais ne certifie pas tous les futurs états de dérive.

## Sources techniques

- [AWS : custom MAIL FROM et exemple SPF](https://docs.aws.amazon.com/ses/latest/dg/mail-from.html).
- [AWS : sortie du sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html).
- [AWS : contrat SendEmail](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
- [AWS : rebonds permanents, temporaires et indéterminés](https://docs.aws.amazon.com/ses/latest/dg/notification-contents.html).
- [AWS : événements SES dans EventBridge](https://docs.aws.amazon.com/ses/latest/dg/monitoring-eventbridge.html).
- [AWS : permissions SES v2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html).
- [Postmark : API du serveur](https://postmarkapp.com/developer/api/server-api).
