# YoDevMail - clôture du déploiement du 6 septembre 2026

Ce relevé complète l'[audit de production](production-readiness-audit-2026-09-06.md). Il est enregistré localement après la fusion ; il ne correspond pas à un nouveau déploiement de code.

## Résultat

Les correctifs de la PR [#35](https://github.com/YoannDrx/yodev-mail/pull/35) sont fusionnés et déployés. **Le verdict commercial reste NO-GO** : SES demeure en sandbox, la facturation n'est pas certifiée et la chaîne applicative complète de cette version n'a pas encore été rejouée en conditions réelles.

| Contrôle | Preuve finale |
|---|---|
| Fusion | `ffbeed06dce8634fafd51d8613ae09d94c22c6ca`, le 6 septembre à 20:08:52 UTC |
| CI de la dernière tête de PR | [Run 34056905177](https://github.com/YoannDrx/yodev-mail/actions/runs/34056905177) : contrôles réussis ; protection de branche respectée |
| Vercel Production | `dpl_7RN2cXA2vbyvyBa3cWhZs7VyiDH7`, état `READY`, commit `ffbeed0` |
| Application | `https://mail.yodev.fr/api/health` : HTTP 200, `status=ok`, `database=ok`, `version=ffbeed0` |
| API | `https://api.mail.yodev.fr/health` : HTTP 200, `status=ok`, `database=ok`, `version=ffbeed0` |
| Journaux Vercel | Zéro enregistrement d'erreur retourné pour ce déploiement, filtre `error`, fenêtre demandée une heure, limite 100. Le déploiement étant récent, cela ne couvre qu'un bref fonctionnement après publication, sans validation sous charge |
| Export de télémétrie Vercel | L'API Drains de l'équipe retourne une liste vide ; aucun export Drains configuré observé |
| AWS Dev et Prod | Déploiements terminés, chacun `IN_SYNC` après contrôle de dérive ; 26 workers en standby au total et aucun mapping SQS actif |

Les neuf interrupteurs fonctionnels fermés ont été écrits avant la création de ce déploiement Production. Aucun secret, schéma de données, paiement ou envoi à un client n'a été modifié par cette clôture.

## Localisation et limites

Vercel indique des fonctions en `iad1` (États-Unis). Les pages légales du dépôt déclarent Vercel aux États-Unis et les transferts possibles hors EEE ; elles distinguent Neon en région européenne. Il n'a donc pas été établi de contradiction avec une promesse d'hébergement intégralement européen. Ce constat n'est pas une validation juridique ni une certification de conformité ; aucune migration de région n'a été entreprise.

La santé HTTP et l'absence d'erreur sur une courte fenêtre ne remplacent pas les preuves restantes de l'audit : décision favorable AWS, binding SES applicatif, parcours complet d'envoi et de retour d'événements, facturation Stripe dédiée, restauration, alertes, isolation multi-tenant et observation après activation.
