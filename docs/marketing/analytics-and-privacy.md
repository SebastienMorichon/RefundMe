# Mesure du lancement et confidentialité

## Niveau 1 - actif dans l'application

Le tableau de bord administrateur `/admin/marketing` calcule des statistiques agrégées à partir des données métier déjà présentes. Il n'ajoute aucun traceur et n'expose ni e-mail, ni document, ni identifiant client.

Fenêtres disponibles : 7 jours, 28 jours et depuis le lancement. Pour les fenêtres temporelles, les conversions sont attribuées à la cohorte selon la date de création du compte.

## Niveau 2 - mesure d'audience à configurer plus tard

Pour mesurer les visites et leur provenance, la recommandation est une instance Matomo séparée et auto-hébergée. Elle ne doit être activée qu'après vérification documentée de sa configuration juridique et technique.

Principes minimaux :

- pages publiques uniquement ;
- aucune donnée personnelle, aucun identifiant de compte ou de dossier ;
- aucune URL contenant un jeton ;
- IP tronquée et données isolées ;
- aucune publicité, heatmap, session recording ou recoupement avec la base clients ;
- durées de traceur et de conservation bornées ;
- information claire et mécanisme d'opposition ;
- bascule vers un consentement explicite si l'exemption n'est pas démontrée.

Les textes Cookies et Confidentialité doivent être mis à jour avant l'activation. La base applicative reste la source de vérité des conversions ; les données Matomo ne doivent pas être jointes aux comptes utilisateurs.
