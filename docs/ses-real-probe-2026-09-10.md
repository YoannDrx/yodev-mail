# Sonde IAM SES réelle - 10 septembre 2026

Statut : **44 contrôles de provisioning réussis ; DNS publiés ; SendEmail non testé**.
Ce résultat ne certifie ni la livraison ni la chaîne applicative et ne vaut pas
autorisation commerciale AWS. Les stacks applicatives Dev/Prod restent en standby.

## Périmètre

- Compte dédié `764858776290`, région `eu-west-3`, profil SSO `yodev-mail-test`.
- Stack `YodevMailSesProbe`, `CREATE_COMPLETE` le 10 septembre à 14:06:23 CEST.
- Quatre rôles `yodev-mail-test-ses-{dev|prod}-{sender|provisioner}`. Ces noms
  représentent deux environnements synthétiques **dans le compte de test**.
- Seul le rôle SSO opérateur exact de ce compte peut les assumer. Sessions
  demandées de 900 secondes, identifiants temporaires en mémoire uniquement.
- Aucune Lambda, URL publique, base, file, permission de secret ou déclencheur.
- CloudTrail de gestion actif avant les essais ; destinations SES de la sonde
  explicitement désactivées, aucun contenu email journalisé par la sonde.

L'adaptation du plan utilise des rôles assumés depuis le poste opérateur plutôt
qu'une Lambda : elle teste directement les mêmes permissions SES avec moins de
ressources. `infra/ses-permissions.ts` est la source commune des politiques des
workers et de la sonde, sans élargissement de permission pour faire passer un test.
La confiance des rôles de test est distincte de celle des workers Lambda.

Synthèse stricte et contrôle `cdk-nag` exécuté réellement : zéro violation non
reconnue. Les exceptions IAM5 reconnaissent uniquement les motifs ARN SES précis
nécessaires aux ressources dynamiques, pas `Resource:*` ni des actions wildcard.
La validation statique ne remplace pas les appels réels ci-dessous.

Après intégration du correctif de sécurité de `main`, `npm ci` et `npm audit`
passent sans vulnérabilité connue ; `npm run check` réussit (253 tests, lint,
types, build Next.js 16.3.4), ainsi que huit tests navigateur et la synthèse
stricte de test. Les empreintes SHA-256 des seuls statements SES des templates
Dev et Prod sont identiques avant/après extraction vers le module partagé :
aucune modification de ces permissions n'est cachée dans cette extraction.

Le premier passage CI après ajout de cette synthèse s'arrête sur le garde-fou
de région : sans profil AWS, CDK choisit `us-east-1` par défaut. Reproduction
locale avec fichiers de configuration AWS vides : même région par défaut.
La CI fixe désormais `AWS_REGION` et `AWS_DEFAULT_REGION` à `eu-west-3` pour
cette seule étape, sans identifiant AWS. Le garde-fou n'est ni supprimé ni
assoupli et aucun contrôle en échec n'est ignoré.

## Appels réels

Exécution `20260910a`, script `scripts/certify-ses-test.mts`. Assertions STS avant
tout essai et après chaque changement de rôle. Aucune utilisation du rôle
administrateur pour effectuer les opérations censées tester un provisioner.

| Phase | Autorisations attendues | Refus IAM attendus | Résultat |
| --- | ---: | ---: | --- |
| Création : configuration, identité taguée, tenant | 6 | 8 | 14/14 |
| Lecture, MAIL FROM, associations, destinations, réputation | 16 | 14 | 30/30 |
| Total | 22 | 22 | 44/44 |

Les refus sont des `AccessDeniedException` HTTP 403. Les erreurs de validation,
identité non vérifiée, absence de ressource, quota ou timeout ne sont pas comptées
comme preuves d'isolation. Un succès inattendu arrête le script. Les créations
préexistantes ne sont pas réutilisées à l'aveugle et les appels ne sont pas relancés
automatiquement après un résultat incertain.

Cas contrôlés dans les deux sens : configuration d'un autre environnement,
création d'identité avec tag opposé ou absent, lecture d'un tenant opposé,
modification MAIL FROM d'une identité opposée, associations avec identité,
configuration ou tenant opposés, création/mise à jour de destination opposée.
La politique de réputation `standard` est acceptée sur le tenant propre.

Exemples d'identifiants de requêtes AWS permettant de retrouver les preuves :

- Création configuration Dev : `7904bed0-3398-4348-991f-140c077b03e3`.
- Création identité Dev : `7f6dbcc5-33a2-4ee5-b3b6-73441c788a08`.
- Création configuration Prod synthétique : `22cfd0aa-463f-4188-b248-0efe9865d3ec`.
- Création identité Prod synthétique : `eb5224e9-65bc-44e2-81d8-a45f56e7c040`.
- Association Dev vers identité opposée refusée : `9cb6655a-062b-42f1-b2bc-237c779e2948`.
- Association Prod vers identité opposée refusée : `24bbfdc6-98bd-4927-a11e-880acb2f2c7a`.

Les quatre cas positifs CreateConfigurationSet/CreateEmailIdentity refusés par
le simulateur fonctionnent donc réellement avec la politique candidate. La
divergence du simulateur n'est pas déclarée résolue pour SendEmail : les deux
cas positifs d'envoi restent à effectuer.

## Ressources conservées pour terminer l'essai

Deux identités : `dev.ses-probe-20260910a.yodev.fr` et
`prod.ses-probe-20260910a.yodev.fr`, chacune taguée pour son environnement.
Deux tenants `ym-{dev|prod}-ses-probe-20260910a` et deux configurations portant
le même nom avec suffixe `-txn`, associés aux identités propres uniquement.
MAIL FROM : `bounce.{identité}`, comportement `REJECT_MESSAGE`.
Ces ressources synthétiques ne sont pas des workspaces clients et n'ont aucune
liaison avec la base applicative. Elles devront être nettoyées explicitement
après la certification ; les journaux d'audit restent conservés.

## DNS publiés après déverrouillage du Mac

Après déverrouillage, les dix enregistrements ci-dessous sont ajoutés à la zone
OVH existante, sans modification ni suppression des cinquante entrées initiales.
La liste OVH affiche ensuite 60/60 résultats. TTL : 3600 secondes.

Chaque valeur est relue directement sur **les deux serveurs autoritatifs**,
`dns200.anycast.me` et `ns200.anycast.me`. Les vingt réponses correspondent aux
valeurs attendues. Des contrôles complémentaires via les résolveurs Cloudflare
et Google retrouvent également les CNAME et MX des deux environnements.
L'avertissement OVH « zone non autoritaire » ne correspond pas aux observations :
la délégation publique nomme ces mêmes serveurs et leurs réponses portent le
drapeau `aa`. Aucun changement de délégation, DNSSEC, MX principal ou DMARC.

Noms relatifs à la zone `yodev.fr` ; cibles CNAME/MX absolues :

| Type | Nom | Cible / valeur |
| --- | --- | --- |
| CNAME | zc5jhhmzc4lmvwkzh6ytoravrhvk43zn._domainkey.dev.ses-probe-20260910a | zc5jhhmzc4lmvwkzh6ytoravrhvk43zn.dkim.amazonses.com. |
| CNAME | oa6kbvg5aqvwswl37dnw7ctdcej6pnmh._domainkey.dev.ses-probe-20260910a | oa6kbvg5aqvwswl37dnw7ctdcej6pnmh.dkim.amazonses.com. |
| CNAME | wq2bnb775uyqjkx2qpxmkrwq7cp63ldo._domainkey.dev.ses-probe-20260910a | wq2bnb775uyqjkx2qpxmkrwq7cp63ldo.dkim.amazonses.com. |
| CNAME | lncphqcboq5ometsktdlhnapfbcg56ak._domainkey.prod.ses-probe-20260910a | lncphqcboq5ometsktdlhnapfbcg56ak.dkim.amazonses.com. |
| CNAME | 3hc7teyattbrfqa2f43yej6edqzzqgk3._domainkey.prod.ses-probe-20260910a | 3hc7teyattbrfqa2f43yej6edqzzqgk3.dkim.amazonses.com. |
| CNAME | 2hwzdrvsmm3npeihgr5ziwnugyez2zs3._domainkey.prod.ses-probe-20260910a | 2hwzdrvsmm3npeihgr5ziwnugyez2zs3.dkim.amazonses.com. |
| MX | bounce.dev.ses-probe-20260910a | 10 feedback-smtp.eu-west-3.amazonses.com. |
| TXT | bounce.dev.ses-probe-20260910a | v=spf1 include:amazonses.com -all |
| MX | bounce.prod.ses-probe-20260910a | 10 feedback-smtp.eu-west-3.amazonses.com. |
| TXT | bounce.prod.ses-probe-20260910a | v=spf1 include:amazonses.com -all |

## Sonde d'envoi implémentée, validation SES encore attendue

À la relecture après publication DNS, AWS retourne encore, pour les deux
identités, `VerifiedForSendingStatus=false`, DKIM `PENDING`, MAIL FROM `PENDING`.
Le précontrôle réel du nouveau script s'arrête sur `ProbeIdentityNotReady` avant
tout SendEmail : zéro tentative, zéro message accepté. Il ne faut pas relancer
la création des identités pour accélérer la validation.

La phase d'envoi est séparée du provisioning afin de ne pas recréer ou modifier
les ressources existantes :

```bash
npx tsx scripts/certify-ses-send.mts --send-to-simulator 20260910a
```

Le script exige le compte de test, l'opérateur SSO exact et un sandbox sain.
Avant tout envoi, il vérifie les deux identités : propriété, vérification,
signature DKIM active, MAIL FROM `SUCCESS` avec `REJECT_MESSAGE`, tenant associé
aux deux seules ressources attendues, configuration active et destinations
d'événements désactivées. Il assume ensuite uniquement les rôles sender de test.

Douze scénarios prévus : pour chaque rôle, envoi propre attendu autorisé ;
absence de tenant, tenant opposé, configuration opposée, identité opposée et
ensemble opposé attendus refusés par IAM. L'unique destinataire est codé en dur :
le simulateur SES de succès, non configurable par argument ou environnement.
Contenu entièrement synthétique, aucun tag contenant une adresse ou du contenu.
Les credentials STS restent en mémoire ; aucun identifiant root ou clé statique.

`maxAttempts=1`, délai de 1100 ms entre essais, arrêt sur succès inattendu ou
résultat non interprétable. Un HTTP 200 doit avoir un `MessageId` pour compter
comme acceptation ; seuls les vrais refus IAM 403 comptent pour l'isolation.
Les sorties excluent messages d'erreur bruts, adresses et contenu. Un identifiant
SES prouvera l'acceptation, **pas la livraison**, les événements de la sonde
restant volontairement désactivés. Ne pas relancer après un résultat incertain
sans réconciliation opérateur.

Vérifications locales de cette reprise : neuf tests ciblés des sondes, puis
`npm run check` complet (259 tests, 40 fichiers, lint, types et build), ainsi que
`npm run test:e2e` (8/8). Le typage initial des fixtures MAIL FROM a été corrigé
avant la validation complète. Aucun changement de politique IAM ou déploiement
applicatif dans cette reprise.

Ne pas fusionner la PR #44 avant ces preuves et la relecture des permissions.
Une sonde IAM réussie ne certifiera toujours pas EventBridge/SQS, l'ingestion,
le ledger, les fournisseurs de boîtes de réception ou la réputation commerciale.
L'identité historique `mail.yodev.fr` du compte existant est intacte.

## Référence

[AWS SES CreateEmailIdentity : vérification DKIM du domaine](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateEmailIdentity.html).
[AWS SES SendEmail : associations tenant et acceptation](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
[AWS SES mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html).
