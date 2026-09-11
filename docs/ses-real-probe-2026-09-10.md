# Sonde IAM SES réelle - 10 septembre 2026

Statut : **44 contrôles de provisioning et 12 contrôles SendEmail réussis dans le compte de test**.
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
workers et de la sonde. Le changement de frontière d'autorisation d'envoi est
explicité ci-dessous ; il ne s'agit pas d'une autorisation inconditionnelle.
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
le simulateur fonctionnent donc réellement avec la politique candidate. Les
permissions de provisioning n'ont pas changé depuis ces 44 contrôles.

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

## Validation DNS et sonde d'envoi

À la première relecture après publication DNS, AWS retournait, pour les deux
identités, `VerifiedForSendingStatus=false`, DKIM `PENDING`, MAIL FROM `PENDING`.
Le précontrôle réel du nouveau script s'est arrêté sur `ProbeIdentityNotReady` avant
tout SendEmail : zéro tentative, zéro message accepté. Il ne faut pas relancer
la création des identités pour accélérer la validation. À la reprise du même
jour, les deux identités sont vérifiées : `VerifiedForSendingStatus=true`,
DKIM `SUCCESS`, signature active et MAIL FROM `SUCCESS`.

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

Douze scénarios : pour chaque rôle, envoi propre attendu autorisé ;
absence de tenant, tenant opposé, configuration opposée, identité opposée et
ensemble opposé attendus refusés. Le contrôle d'identité opposée relève de
l'association SES au tenant ; les huit autres refus relèvent d'IAM.
L'unique destinataire est codé en dur :
le simulateur SES de succès, non configurable par argument ou environnement.
Contenu entièrement synthétique, aucun tag contenant une adresse ou du contenu.
Les credentials STS restent en mémoire ; aucun identifiant root ou clé statique.

Pour SendEmail : `maxAttempts=1`, délai de 1100 ms entre essais, arrêt sur succès inattendu ou
résultat non interprétable. Un HTTP 200 doit avoir un `MessageId` pour compter
comme acceptation ; seuls les refus `AccessDeniedException`/`AccessDenied` 403
comptent pour l'isolation. Les refus d'association SES sont distingués des refus
IAM ; les erreurs 400, quotas et timeouts ne passent pas. Les lectures de contrôle
et STS ont trois tentatives au maximum, bornées à 60 secondes après des timeouts
observés avant tout envoi. Ces reprises ne s'appliquent jamais à SendEmail.
Les sorties excluent messages d'erreur bruts, adresses et contenu. Un identifiant
SES prouve l'acceptation, **pas la livraison**, les événements de la sonde
restant volontairement désactivés. Ne pas relancer après un résultat incertain
sans réconciliation opérateur.

## Défaut réel détecté et correction de la politique d'envoi

La première politique candidate refuse les deux envois légitimes, même après
validation DNS. Les dix refus négatifs seuls ne constituaient donc pas une preuve
d'isolation utilisable. Trois matrices de 12 essais confirment ces refus, y
compris en fournissant explicitement `FromEmailAddressIdentityArn`.

Une stack temporaire à quatre rôles compare la même requête Dev, limitée à
l'identité/configuration exactes et au seul destinataire du simulateur SES :

| Condition supplémentaire | Résultat réel | Request ID |
| --- | --- | --- |
| Aucune (ressources et destinataire exacts) | Accepté | f2279e38-59a7-459e-baa5-65ff90ee94ea |
| Tag de propriété de l'identité | Refus 403 | 8c2e188b-32c0-49c0-ab0b-3125652ac801 |
| Tenant, StringLike | Accepté | bd22bfff-ec82-4be4-a98b-83c766b7a0e0 |
| Tenant, StringEquals | Accepté | b32dbf36-6fee-4b19-bf16-1ef9a83a6d04 |

Correction : SendEmail exige le tenant de l'environnement et les ARN du
compte/région, avec configurations limitées au préfixe de l'environnement.
La condition `aws:ResourceTag/yodev:environment` est retirée **de SendEmail
seulement** : elle reste obligatoire sur les écritures d'association d'identité
et MAIL FROM. SES contrôle à l'envoi que l'identité appartient au tenant.
Il s'agit d'une frontière combinée **IAM tenant + association SES**, et non
d'une isolation d'envoi par tag IAM. Les associations historiques doivent être
inventoriées avant activation ; un tag seul ne déplace pas une association.

La référence AWS liste pourtant ResourceTag pour SendEmail. Les observations
ci-dessus justifient le diagnostic dans ce compte/région, pas une affirmation
de bug AWS universel ou officiellement confirmé. La documentation des tenants
SES confirme le contrôle des associations à chaque envoi.

Le changement CDK touche uniquement les deux politiques des rôles sender dans
`YodevMailSesProbe`, sans remplacement. Après une interruption réseau du client
CDK, le change set préparé a été relu puis exécuté exactement, sans recréation
de ressources. Stack `UPDATE_COMPLETE` à `2026-09-10T15:35:23.575Z`, dérive
`IN_SYNC`, zéro ressource dérivée. Les quatre politiques déployées correspondent
exactement à la synthèse commune, y compris les provisioners inchangés.

## Matrice finale : 12/12

| Cas | Dev synthétique | Prod synthétique | Contrôle effectif |
| --- | --- | --- | --- |
| Envoi propre | Accepté 200 + MessageId | Accepté 200 + MessageId | IAM et associations valides |
| Sans tenant | Refus 403 | Refus 403 | IAM |
| Tenant opposé | Refus 403 | Refus 403 | IAM |
| Configuration opposée | Refus 403 | Refus 403 | IAM |
| Identité opposée | Refus 403 | Refus 403 | Association SES |
| Toutes ressources opposées | Refus 403 | Refus 403 | IAM |

Acceptation Dev : requête `e2a244d4-4f9e-46c6-973b-10d9a0853921`, MessageId
`011301a08bf6fda1-d07de562-b226-480a-830b-ea1fc48774b4-000000`.
Acceptation Prod synthétique : requête `9f751067-c98c-4c01-a531-6770ba643d83`,
MessageId `011301a08bf73c95-6c726079-c953-4238-9029-cba1913a9164-000000`.
Refus d'identité opposée : Dev `bd5fcc6e-70ed-493f-ae3d-3585b4c68338`,
Prod `f5288379-19f6-4a68-80aa-09dafe9957e8`, raison assainie
`resource-not-associated`. Sortie du script : 12 cas, zéro échec, deux
acceptations, `deliveryCertified=false`, code de sortie 0. Le libellé du script
a ensuite été précisé en `tenant-denied` pour ces deux refus, avec test de
régression ; aucune nouvelle tentative n'est nécessaire pour renommer une trace.

Les 44 contrôles de provisioning plus ces 12 contrôles donnent **56 résultats
attendus**, pas 56 messages envoyés. Avec les comparaisons de diagnostic, cinq
messages synthétiques ont été acceptés au total ; aucune boîte réelle ciblée.
CloudTrail de gestion reste actif et sans erreur de livraison ; il ne s'agit
pas d'une collecte d'événements de données SendEmail ou de livraison.

Le simulateur IAM reste divergent : nouvelle matrice 76 cas, 66 résultats
attendus et dix refus inattendus (cinq par environnement : les trois cas
SendEmail attendus autorisés au niveau IAM seul et les deux créations). Zéro
autorisation inattendue ; code de sortie 1 conservé. Les cas SendEmail d'identité
non attribuée/opposée sont volontairement autorisés **dans la simulation IAM
seule** avec le bon tenant ; la matrice réelle vérifie le refus d'association
SES. `accessanalyzer validate-policy` : zéro constat pour les quatre politiques.
La simulation n'est pas présentée comme verte ni comme un substitut aux appels
réels. La CI n'exécute pas cette simulation externe.

## Nettoyage et validation locale finale

La stack `YodevMailSesConditionProbe` et ses quatre rôles de comparaison sont
supprimés : `DELETE_COMPLETE` confirmé, suppression commencée à
`2026-09-10T15:50:46.326Z`. Leur code reste disponible, uniquement sur opt-in
`sesDiagnostics=true`, pour reproduire le diagnostic dans le compte de test.
La fondation d'audit, ses journaux, les quatre rôles candidats, les identités
synthétiques et leurs DNS sont conservés. Aucun domaine historique supprimé.

`npm run check` final : 264 tests dans 41 fichiers, lint, typage et build réussis.
`npm run test:e2e` : huit parcours publics Chromium réussis. `agent-browser`
indisponible ; pas de contrôle visuel supplémentaire. Le serveur de développement
a utilisé les polices de repli après des erreurs réseau Google Fonts ; le build
de production a réussi. Ce test ne certifie pas les parcours OAuth réels.
Les synthèses strictes applicative et de test passent, contrôle `cdk-nag` sans
violation non reconnue. La relecture cible les permissions, la séparation des
reprises de lectures/envois, l'absence de données privées dans les diagnostics
et le bornage exact des rôles temporaires. Pas de constat bloquant supplémentaire
sur ce diff ; les limites de simulation et de certification ci-dessous restent
explicites.

La PR #44 a été fusionnée après la relecture et les validations finales,
puis publiée en standby ; preuves de publication ci-dessous.
Ces contrôles réussis ne certifient toujours pas EventBridge/SQS, l'ingestion,
le ledger, les fournisseurs de boîtes de réception ou la réputation commerciale.
L'identité historique `mail.yodev.fr` du compte existant est intacte : vérifiée,
DKIM/MAIL FROM `SUCCESS`, aucun tag d'environnement, seul tenant associé
`ym-sandbox-cert`. L'inventaire du compte existant ne retourne aucun tenant
`ym-dev-*` ou `ym-prod-*`. Les sondes n'ont pas activé les workloads ; la
publication ultérieure conserve le standby et tous les gates fermés.

## Publication en standby après certification

[PR #44](https://github.com/YoannDrx/yodev-mail/pull/44) fusionnée le 10 septembre
à `16:20:09Z`, commit `a65f72d2bca12e2412d5931863338ea7a249244a`. Le contenu
fusionné est identique au commit vérifié `9df9f6f`. Les
[contrôles de PR](https://github.com/YoannDrx/yodev-mail/actions/runs/34500547119)
et la [CI main](https://github.com/YoannDrx/yodev-mail/actions/runs/34501437434)
sont tous réussis, y compris intégration PostgreSQL et parcours authentifiés.
La couverture complète de PR exécute 378 tests dans 51 fichiers ; les seuils
configurés restent inchangés. Ce résultat n'inclut pas la simulation IAM externe
divergente, conservée séparément ci-dessus.

Vercel Production `dpl_HVjanc6FfPHDnWPGQ1Z5mLd7RhWN` : `READY`, build environ
44 secondes, Next.js 16.3.4. `mail.yodev.fr/api/health` et
`api.mail.yodev.fr/health` retournent `status=ok`, `database=ok`,
`version=a65f72d`. Le scan des erreurs/fatal de ce déploiement depuis
`16:20:09Z` ne retourne aucune entrée lors des contrôles post-publication.
C'est une observation ponctuelle sur une fenêtre courte, pas une certification
sous charge ni un suivi de canaris de 72 heures.

AWS Dev : `UPDATE_COMPLETE` à `16:21:33Z`. AWS Prod : `UPDATE_COMPLETE` à
`16:24:24Z`. Deux politiques IAM et les assets des deux workers SendEmail et
ProviderProvisioning mis à jour dans chaque stack ; pas de changement de
stockage, schéma, fondation ou gate, pas de remplacement de ressource métier.
Les quatre politiques SES relues dans IAM correspondent aux templates vérifiés.
La relecture des ressources réellement rattachées aux stacks confirme 26 workers
en standby, SES/Postmark désactivés, 20 règles EventBridge désactivées et zéro
mapping SQS. Les contrôles de dérive Dev et Prod sont `IN_SYNC`, zéro ressource
dérivée dans les deux stacks.

Le statut SES du compte applicatif relu après fusion reste : production `false`,
revue `DENIED`, envoi sandbox activé, enforcement `HEALTHY`. Aucun contournement
de cette décision, aucun message client, paiement ou activation commerciale.
Ces preuves post-publication sont ajoutées au rapport local après fusion ; le
commentaire de clôture de la PR conserve également l'état de publication.

## Référence

[AWS SES CreateEmailIdentity : vérification DKIM du domaine](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateEmailIdentity.html).
[AWS SES SendEmail : associations tenant et acceptation](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).
[AWS SES mailbox simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html).
[AWS SES : contrôle des associations aux tenants](https://docs.aws.amazon.com/ses/latest/dg/tenants.html).
[Référence des autorisations SES v2](https://docs.aws.amazon.com/service-authorization/latest/reference/list_sesv2.html).
