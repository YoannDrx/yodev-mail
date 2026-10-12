# Postmark - reprise du provisioning et certification du 7 septembre 2026

## Résultat et périmètre

Ce lot poursuit les sept constats de la certification de provisioning #38.
Il corrige la création et la reprise des comptes Postmark, sans activer les
envois clients ni modifier de credential ou de webhook fournisseur réel.
Le statut commercial reste **NO-GO**. Les tests locaux emploient exclusivement
des identifiants synthétiques, PostgreSQL local et des transports simulés.

## Défauts reproduits et corrections

Deux tests ont échoué sur le code initial : deux workspaces de même nom
pouvaient adopter le même serveur, et un échec de listing des webhooks était
traité comme une liste vide, entraînant une nouvelle création.

- Un nouveau serveur porte une identité opaque stable, dérivée de
  l'environnement et de l'UUID du workspace. Un compte déjà lié continue
  d'utiliser son ID fournisseur, sans renommage ou migration implicite.
- Les listes de serveurs et domaines sont paginées ; une réponse incomplète,
  incohérente ou ambiguë bloque le provisioning. Les erreurs HTTP ne sont plus
  assimilées à une absence de ressource. Les redirections HTTP sont refusées.
- L'intention de création du serveur, son ID, puis les références de ses
  credentials sont enregistrés par étapes durables. Le compte reste `pending`
  jusqu'à la fin ; un compte déjà `ready` ne régresse pas pendant l'ajout d'un
  autre domaine.
- Les paramètres SSM SecureString sont créés sans écrasement, avec la clé KMS
  configurée. Une reprise relit ceux déjà présents et vérifie que le token
  appartient au serveur lié. Elle ne renouvelle pas implicitement le mot de
  passe d'un webhook. Aucun secret réel n'a été lu pour ces tests.
- Les checkpoints sont committés avant `Verify=true` : le callback HTTP peut
  authentifier la vérification de Postmark avant la finalisation du compte.
- Un webhook existant est mis à jour en place avec authentification, événements
  de livraison/rebond/plainte, contenu exclu et tracking fermé. La réponse doit
  confirmer `Status=verified` avant la disponibilité du binding.
- Une création incertaine ne déclenche pas automatiquement une deuxième
  création. Le serveur est recherché par son identité stable ; le webhook par
  son URL exacte. Un marqueur durable protège l'incertitude du webhook, y
  compris après une demande admin de reprise.
- Un verrou consultatif PostgreSQL transactionnel par workspace sérialise les
  provisioning concurrents. Il reste sur une connexion dédiée, pendant que des
  transactions courtes publient les checkpoints visibles par le callback. Il
  se libère avec la transaction, y compris après un échec.
- Un même signal d'annulation borne les appels externes de provisioning,
  Postmark, SES/STS et chargement SSM, à 35 secondes au maximum, réduit selon le
  temps Lambda restant. Les checkpoints/finalisations ont un timeout SQL de
  cinq secondes. Cela ne constitue pas une garantie d'échéance absolue sur
  toutes les acquisitions de connexion ou requêtes PostgreSQL.
- Le contrôle DNS ne peut plus faire passer un provisioning `pending` ou
  `failed` en état vérifié à partir d'une ancienne identité externe. Un résultat
  DNS tardif ne peut pas effacer un nouvel échec de provisioning.

## Réconciliation opérateur et limites

Quand la création du serveur n'a pas de résultat certain et qu'aucun serveur
exact ne peut être retrouvé, le compte reste en attente. Quand la création du
webhook est incertaine et qu'aucune URL exacte n'est retrouvée, le marqueur
`postmark_webhook_creation_requires_reconciliation` est conservé. Ces situations
exigent une vérification autoritative côté fournisseur avant toute décision de
relancer une création. Ne pas effacer le marqueur, supprimer le compte pending,
tourner les secrets ou purger les files pour débloquer automatiquement.

La documentation indique notamment qu'une vérification explicitement refusée
par Postmark lors d'un POST ne sauvegarde pas le webhook. Ce lot ne distingue
pas encore ce refus définitif d'une réponse réseau incertaine dans son état
durable : il choisit de bloquer sans doubler la création. Une procédure/outillage
opérateur pour lever une incertitude après preuve reste à certifier.

Le verrou consomme une connexion supplémentaire pendant le provisioning. Le
pool applicatif est de dix connexions ; l'activation devra valider la capacité
et le comportement sur le pooler Neon, en plus des tests PostgreSQL locaux.
Une requête externe déjà exécutée ne peut pas être annulée rétroactivement
après suspension ou expiration du délai. Les gardes d'écriture restent fermées
et la ressource externe éventuelle doit être réconciliée.

La vérification webhook Postmark réelle, ses payloads de vérification, les
droits IAM effectifs, les créations et reprises sur le compte fournisseur ne
sont pas certifiés par des mocks. Aucun email ni appel de création réel n'est
effectué dans ce lot. Les blocages SES production, Stripe Live, restauration,
supervision et observation contrôlée restent distincts.

## Tests

- 17 tests unitaires du flux Postmark : identité stable, pagination au-delà de
  500, listing invalide/ambigu, checkpoints, secrets non écrasés, conflit
  d'identité, reprise, webhook existant/incertain/non vérifié et annulation.
- 23 tests PostgreSQL du worker, dont concurrence, commits avant callback,
  reprise d'intention et préservation des suspensions/comptes déjà prêts.
- 7 tests PostgreSQL admin et 10 du contrôle DNS, incluant la conservation du
  marqueur et les résultats tardifs.
- 2 tests combinent le vrai worker, le vrai flux Postmark et le vrai endpoint
  HTTP avec PostgreSQL : les trois callbacks Delivery/Bounce/SpamComplaint
  obtiennent 200 avant readiness ; une réponse de création perdue se reprend
  par PUT du même webhook, sans nouveau POST ni rotation de credentials.
- 7 tests SES et 10 de chargement des secrets, dont propagation du même signal
  d'annulation et refus d'un budget déjà expiré.

Le conteneur local historique a échoué avant les assertions avec une erreur
PostgreSQL `global/pg_filenode.map: Input/output error`. Il n'a pas été supprimé
ni réinitialisé ; aucune base distante n'a été utilisée comme substitut. Une
nouvelle instance PostgreSQL 17.11 native isolée sur `127.0.0.1:55443`, répertoire
`/tmp/yodev-mail-postmark-pg.UBSkvc`, reçoit les dix migrations existantes. Les
tests d'intégration y passent. Un premier lancement complet a rencontré un
échec pendant une modification simultanée du test et de son module ; le test
ciblé sur le code stabilisé passe. Les vérifications finales seront consignées
ci-dessous sans masquer ces essais intermédiaires.

## Références officielles consultées

- [Serveurs Postmark](https://postmarkapp.com/developer/api/servers-api) et
  [domaines](https://postmarkapp.com/developer/api/domains-api) : pagination et
  identification exacte.
- [Webhooks Postmark](https://postmarkapp.com/developer/api/webhooks-api) :
  `Verify`, statut de vérification, création et mise à jour.
- [Erreurs Postmark](https://postmarkapp.com/developer/api/overview) : unicité des
  noms de serveur et domaines, sans supposer une idempotence HTTP générique.
- [SSM PutParameter](https://docs.aws.amazon.com/systems-manager/latest/APIReference/API_PutParameter.html) :
  création sans écrasement et erreur `ParameterAlreadyExists`.
- [Verrous consultatifs PostgreSQL](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS) :
  portée transactionnelle et libération automatique.

## Vérification finale et publication

Vérifications locales sur le code stabilisé :

- `npm run check` : lint, TypeScript, 188 tests unitaires et build Next.js verts.
- `npm run test:coverage:full` : 288 tests dans 44 fichiers, tous verts ;
  78,71 % des lignes, 71,11 % des branches, seuils globaux et ciblés conservés.
  Le worker de provisioning atteint 100 % des lignes et 91,66 % des branches ;
  le flux Postmark 98,95 % des lignes et 87,50 % des branches.
- `npm run test:e2e` : huit parcours Chromium publics passent en 23,2 secondes.
  L'outil agent-browser n'est pas installé ; la vérification locale s'appuie
  sur les scénarios Playwright du dépôt, pas sur un contrôle visuel supplémentaire.

Publication terminée via la [PR #39](https://github.com/YoannDrx/yodev-mail/pull/39),
fusionnée le 7 septembre à 01:13:38 heure de Paris (6 septembre, 23:13:38 UTC).
Commit fusionné `bc8a9e0dffc1cc652042b2376c8e06950a343dca`, head testé
`83e7211148e1950add198b4fd56ebc119dad6635` ; leurs arbres sont identiques.

- [CI de PR](https://github.com/YoannDrx/yodev-mail/actions/runs/34066153965) et
  [CI de main](https://github.com/YoannDrx/yodev-mail/actions/runs/34066281210)
  entièrement vertes. Les six contrôles obligatoires sont conservés, y compris
  les parcours authentifiés ; aucun contournement de protection.
- Huit parcours authentifiés passent en CI de PR en 58,8 secondes. Les huit
  parcours publics et les tests PostgreSQL passent aussi dans les deux CI.
- Vercel Production `dpl_2HjE3AvMGoQH9uSeu9NmnCfZA3pb`, `READY`, framework
  Next.js, build observé 32,6 secondes. URL technique :
  `https://yodev-mail-564ku0210-yoanndrxs-projects.vercel.app`.
- `https://api.mail.yodev.fr/health` répond `status=ok`, `database=ok`,
  `version=bc8a9e0`. Le health de `mail.yodev.fr` redirige vers cet endpoint ;
  l'onboarding anonyme redirige en 307 vers `/fr/connexion`.
  Un premier contrôle sur `app.mail.yodev.fr` a échoué en résolution DNS : ce
  n'est pas le domaine configuré du produit et il n'a pas été ajouté au DNS.
- Scan Vercel ciblé sur ce déploiement, niveaux `error` et `fatal` : aucun
  résultat retourné après publication. La fenêtre est courte et sans charge ;
  elle ne remplace pas les canaris de 72 heures. Les drains ne sont pas relus
  dans ce lot ; les lacunes de supervision de l'audit restent ouvertes.
- Le diff CDK examiné ne modifie que les assets de code des 13 workers par
  environnement, du fait du module runtime partagé. Aucune permission,
  variable d'environnement, file, clé ou ressource de stockage ne change ;
  aucun remplacement et aucune migration. Fondation exclue du déploiement.
- AWS Dev `UPDATE_COMPLETE` à 23:15:23 UTC ; AWS Prod à 23:16:34 UTC. Au contrôle
  post-déploiement, 26 workers sur 26 restent `standby`, SES/Postmark faux,
  aucun mapping SQS ; les quatre files de provisioning/DLQ sont vides selon
  leurs compteurs approximatifs visible/invisible/différé.
- Worker de provisioning Prod : `Active`, mise à jour `Successful`, SHA256
  `Ny+RkL4rA9UOjCB4ZsrjAXPkvpSWsy+6h7I0URLhM8o=`. Son origine webhook réelle
  reste `https://mail.yodev.fr`, sans modification.
- SES relu : accès production faux, review `DENIED`, compte sain mais sandbox
  200/jour et 1/s ; identité `mail.yodev.fr` vérifiée, DKIM RSA 2048 et MAIL FROM
  `bounce.mail.yodev.fr` en succès. Ce blocage externe reste inchangé.

Ces preuves post-publication sont ajoutées localement après fusion et seront
committées avec le lot suivant, sans republier les services pour le seul compte
rendu. L'objectif global reste actif : ce lot ne vaut pas GO commercial.
