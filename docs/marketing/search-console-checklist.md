# Mise en service Google Search Console

## Intervention du propriétaire requise

1. Ouvrir Google Search Console avec le compte qui doit rester propriétaire de Lydoc.
2. Ajouter une propriété de domaine `lydoc.fr`.
3. Copier la valeur TXT fournie par Google dans la zone DNS du domaine.
4. Une fois la propriété validée, ouvrir le rapport **Sitemaps** et envoyer `https://lydoc.fr/sitemap.xml`.
5. Inspecter `https://lydoc.fr/`, lancer le test en direct puis demander l'indexation.
6. Répéter l'inspection pour `https://lydoc.fr/guides` après déploiement.

## Alternative de vérification HTML

Si la vérification DNS n'est pas possible, renseigner uniquement la valeur du jeton Google dans `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`, reconstruire l'image web, puis relancer la vérification. Ne jamais copier la balise HTML complète dans cette variable.

## Contrôle hebdomadaire

- nombre de pages indexées ;
- pages exclues et motif ;
- requêtes, impressions, clics et position moyenne ;
- URL avec erreur d'exploration ;
- requêtes qui génèrent des impressions mais peu de clics ;
- guides à enrichir ou à créer.
