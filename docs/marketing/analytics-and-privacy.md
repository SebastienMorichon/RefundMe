# Mesure du lancement et confidentialité

## Niveau 1 - actif dans l'application

Le tableau de bord administrateur `/admin/marketing` calcule des statistiques agrégées à partir des données métier déjà présentes. Il n'ajoute aucun traceur et n'expose ni e-mail, ni document, ni identifiant client.

Fenêtres disponibles : 7 jours, 28 jours et depuis le lancement. Pour les fenêtres temporelles, les conversions sont attribuées à la cohorte selon la date de création du compte.

## Niveau 2 - mesure d'audience GA4 préparée localement

La balise Google Analytics 4 `G-ZTGGYREXDS` est préparée dans le site Web. Elle ne se charge que sur les pages publiques et après acceptation explicite. Le choix est redemandé après six mois. La mesure manuelle des pages supprime les paramètres d'URL et le référent. Les pages de compte, de dossier et d'administration ne doivent pas être mesurées. Les textes Cookies et Confidentialité ont été adaptés dans le code local.

Avant publication, dans **Administration > Flux de données > Lydoc > Mesures améliorées**, désactiver les mesures améliorées (notamment les pages vues fondées sur l'historique du navigateur). Cette option est gérée dans GA4 et peut créer des événements automatiques indépendants du code de page vue manuel. Vérifier aussi que le partage des données, Google Signals et les fonctions publicitaires ne sont pas activés pour cette propriété si elles ne sont pas voulues.

Après publication, vérifier dans le navigateur : refus ou absence de choix = aucune requête vers `googletagmanager.com` ou `google-analytics.com` ; acceptation = visite publique visible dans le rapport Temps réel ; changement de choix = arrêt du chargement de la balise ; navigation vers une page privée = aucune balise. La base applicative reste la source de vérité des conversions et les données d'audience ne sont pas jointes aux comptes utilisateurs.
