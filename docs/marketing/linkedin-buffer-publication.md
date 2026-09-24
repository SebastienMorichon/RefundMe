# Publication automatique des nouveaux guides sur LinkedIn

La page LinkedIn Lydoc est connectée à Buffer. Ce flux publie un post par
nouveau guide, après vérification de sa présence sur le site public. Les guides
antérieurs au 24 septembre 2026 ne sont pas repris.

## Mise en service

1. Dans Buffer, ouvrir [API settings](https://publish.buffer.com/settings/api)
   et créer une clé API personnelle. Elle ne doit jamais être envoyée par chat
   ni ajoutée au dépôt.
2. Dans le dépôt GitHub, ouvrir **Settings → Secrets and variables → Actions**.
   Créer le secret `BUFFER_API_KEY` avec cette clé.
3. Lancer une fois le workflow **Publish new Lydoc guides on LinkedIn** avec
   **Run workflow** et laisser **Vérifier sans publier** activé. Vérifier que
   le journal montre le canal Lydoc et les guides attendus, sans créer de post.
4. Dans le même écran GitHub que le secret, créer la variable
   `LINKEDIN_AUTOPUBLISH_ENABLED` avec la valeur `true`. Cette variable active
   la publication automatique quotidienne.

Le workflow s'exécute ensuite chaque jour à 09 h 30 UTC. Il lit le sitemap et
les données structurées des guides publics, ne retient que les guides dont la
date de publication est au moins le 24 septembre 2026, recherche les URL déjà
présentes dans les posts Buffer du canal LinkedIn Lydoc, puis place les autres
dans la file de publication. Buffer choisit le prochain créneau de cette file.

La recherche des doublons couvre les posts créés dans Buffer depuis la date
d'activation, y compris ceux en attente ou déjà envoyés. Ne supprimez pas ces
posts de Buffer si vous souhaitez qu'ils restent reconnus comme publiés. Une
erreur de lecture du site ou de Buffer fait échouer le workflow et empêche la
création d'un nouveau post lors de cette exécution. Consultez les échecs dans
l'onglet **Actions** du dépôt.

Pour interrompre la publication, passez `LINKEDIN_AUTOPUBLISH_ENABLED` à
`false`. Cela ne supprime pas les posts déjà placés dans la file Buffer.
