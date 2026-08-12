# Inventaire initial des flux email sous `Projets`

Date de l’inventaire : 12 août 2026.

Cet inventaire est en lecture seule. Aucun projet consommateur ne doit être migré avant la stabilisation du pilote Mail by Yodev et l’observation du canari pendant 72 heures. Un domaine vérifié appartient toujours au propriétaire réel de l’application ; `yodev.fr` est réservé aux produits effectivement édités par Yodev.

| Projet | Transport repéré | Flux transactionnels candidats | Flux exclus ou à revoir | Décision initiale |
|---|---|---|---|---|
| EggscuseMe | Resend | Vérification, changement d’email, suppression de compte, expiration d’œufs | Aucun flux marketing confirmé dans le transport | Éligible après profils/templates |
| homego | Resend | Authentification, support, alertes immobilières attendues | Composant newsletter | Migrer les flux transactionnels seulement |
| hyrun | Resend | Authentification et sécurité de compte | Préférences promotionnelles/marketing | Migrer l’authentification seulement au premier passage |
| jobio | Resend | Authentification, rappels de facturation, opportunité entrante | Newsletter et emails composés manuellement à qualifier | Migrer auth/rappels ; revue séparée du reste |
| moodday | Resend | Authentification, invitations d’aidants, événements de compte | Newsletter ; contenu potentiellement sensible | Éligible avec revue renforcée et templates minimisés |
| mycryptopilot | Resend | Invitations et événements de compte | Newsletter ; contenu financier éventuel | Éligible après revue du contenu et de la finalité |
| prodem | Resend | Authentification | Autres usages non établis | Éligible après inventaire fonctionnel complet |
| react-mentor | Resend | Événements de compte | Emails de cycle de vie/bienvenue pouvant être promotionnels | À qualifier avant migration |
| routine-kids | Resend | Vérification d’email et réinitialisation | Aucun flux marketing confirmé | Bon candidat canari après Mail by Yodev interne |
| parigo | Resend détecté | Partage de playlists/catégories | Autres usages non établis | Éligible après validation propriétaire/domaine |
| yodev-ads | Resend | Alertes opérationnelles Google Ads et notifications système | Aucun marketing identifié dans le transport | Premier client interne recommandé après canari Mail |
| yodev | Resend direct | Notification interne du formulaire de contact | Aucun marketing via cette route | Candidat interne, expéditeur Yodev |
| portfolio-caro | Resend direct | Notification de formulaire de contact | Aucun marketing établi | Candidat selon propriétaire réel du domaine |
| portfolio-loic | Resend direct | Notification de formulaire de contact | Aucun marketing établi | Candidat selon propriétaire réel du domaine |
| portfolio-yoann | Resend direct | Notification de formulaire de contact | Aucun marketing établi | Candidat interne Yodev |
| weil-associes | Nodemailer/SMTP | Notification de formulaire de contact | Aucun marketing établi | Candidat selon accord du propriétaire |
| mail-certificate | SMTP/transport historique | Notifications techniques de remise | Nature juridique et promesse de recommandé électronique | Revue contractuelle et technique obligatoire |

## Projets et résultats parasites

- `raycast` contient des occurrences liées à des extensions tierces et des données ; aucune migration Yodev n’est autorisée sur cette base.
- Les fichiers `.env`, sorties de build, lockfiles, workflows et documents historiques ont été exclus du classement fonctionnel.
- Un simple composant nommé `newsletter` ne prouve pas qu’un flux est actif ; il suffit néanmoins à exclure toute migration automatique globale.

## Ordre de migration

1. Flux système interne de Mail by Yodev.
2. Un canari Yodev à faible volume (`yodev` ou `routine-kids` selon disponibilité du domaine).
3. Observation pendant 72 heures : acceptation, livraison, bounce, plainte, webhooks et facturation.
4. `yodev-ads` comme client interne isolé.
5. Projets clients un par un, après validation écrite du domaine, des profils et des templates.
6. Révocation d’une clé Resend uniquement lorsque tous les flux qui la consomment ont été identifiés et validés sur Mail by Yodev.

## Contrôles obligatoires par projet

- propriétaire légal de l’application et du domaine ;
- adresse From et Reply-To ;
- événement déclencheur et relation avec le destinataire ;
- volume quotidien et de pointe ;
- présence de contenu libre, sensible, marketing ou rédigé par un utilisateur ;
- comportement sur erreur et idempotency key stable ;
- modèle de template approuvé ;
- absence de CC/BCC et destinataire unique ;
- DNS DKIM/Return-Path/DMARC validés avant clé live ;
- maintien du transport précédent pendant le rollback de 72 heures.
