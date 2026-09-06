# Certification navigateur authentifiée - 6 septembre 2026

## Périmètre et environnement

Huit parcours Chromium exécutent le vrai serveur Next.js, Better Auth, les Server
Actions et PostgreSQL 17. Aucun mock de session, cookie injecté ou remplacement
du contrôle d'accès. Deux entreprises synthétiques distinctes sont créées pour
chaque scénario dans `yodev_mail_auth_e2e`, sur le conteneur local de certification
existant, port `127.0.0.1:55441`. Les dix migrations commises sont appliquées sans
changement de schéma.

Le runner exige explicitement cette base locale et refuse toute base distante,
autre nom de base ou option de connexion. Neuf tests unitaires couvrent cette
barrière. Les secrets d'authentification sont éphémères. Tous les fournisseurs,
envois réels et paiements sont désactivés dans le processus du serveur de test ;
les requêtes du navigateur hors de son origine locale sont bloquées. Les comptes
vérifiés et invitations en attente sont synthétiques, sans email de notification.

## Scénarios

1. Connexion par mot de passe, accès à un message autorisé, cookie HttpOnly/Lax,
   suppression effective de la session à la déconnexion et refus d'accès ensuite.
2. Refus du changement vers une organisation non autorisée, du message de l'autre
   entreprise et de la console d'administration globale.
3. Changement autorisé entre deux workspaces et changement correspondant de la
   portée des données côté serveur.
4. Retrait d'un membre alors que sa session reste ouverte : accès aux données
   immédiatement refusé et page de récupération fonctionnelle.
5. Création réelle d'une clé API Test par le formulaire, lecture autorisée,
   refus inter-entreprise, secret non réaffiché après rechargement et révocation
   immédiatement appliquée par l'API.
6. Tentative de création de clé par un simple membre refusée par la Server Action,
   sans ligne créée en base.
7. Invitation refusée à une autre adresse, acceptée par son destinataire et non
   réutilisable ; une seule adhésion créée.
8. Enregistrement d'une passkey, déconnexion puis authentification WebAuthn sans
   mot de passe avec l'authentificateur virtuel Chromium.

Chaque scénario contrôle aussi l'absence d'exception navigateur ou de rendu
serveur non gérée. Les artefacts éventuels ne contiennent que des données
synthétiques. La CI dispose d'un job PostgreSQL/navigateur dédié.

## Défaut reproduit et corrigé

La redirection après retrait d'un membre, ou la première connexion avant
acceptation d'une invitation, aboutissait à `/onboarding` qui relançait le même
contrôle d'accès et produisait une erreur serveur. Il n'y avait pas de fuite de
données observée, mais le parcours était cassé.

Les refus attendus utilisent maintenant `WorkspaceAccessError`. La page
d'onboarding exige une session et affiche un état « Aucun workspace accessible »
avec changement de workspace/déconnexion. Les erreurs de base de données restent
des erreurs techniques ; elles ne sont plus transformées en absence de droits.
Quatre tests unitaires couvrent la frontière de redirection, en complément des
tests navigateur. Le parcours public vérifie aussi l'onboarding anonyme.

## Validation

Les 13 tests unitaires ciblés, le lint ciblé et le scénario WebAuthn isolé passent.
Le scénario de retrait et celui d'invitation passent après correction de la page
de récupération. La validation globale est en cours ; ne pas utiliser ce document
comme preuve de publication avant l'ajout des références CI/déploiement.

Deux problèmes du banc de test ont été corrigés séparément : types SQL des
identifiants synthétiques et attentes de compilation/hydratation avant interaction.
Les délais de compilation locale ne sont pas assimilés à une panne de production.

## Limites et conditions commerciales inchangées

Ce lot ne certifie pas Google OAuth réel, l'envoi des emails d'authentification,
des passkeys physiques/Safari, le parcours de paiement ou la délivrabilité. Le
cookie Secure sur HTTPS n'est pas prouvé par ce test local HTTP. Les assertions
d'isolation concernent les chemins listés, pas une preuve exhaustive de tous les
endpoints possibles.

AWS SES reste soumis à l'approbation production et à la certification de la chaîne
complète. Stripe nécessite toujours l'activation du compte et la confirmation du
régime fiscal. Restauration Neon, alertes et canaris restent à fermer. Aucune gate
commerciale n'est ouverte par ce lot et aucun GO commercial n'est prononcé.
