# Exploitation Lydoc

## Endpoints de supervision

- `GET /health/live` confirme que le processus API est actif. Il ne depend pas de PostgreSQL.
- `GET /health/ready` confirme que l'API peut interroger PostgreSQL. Utiliser cet endpoint pour la disponibilite du service.
- `GET /health` est un controle synthetique pour le developpement et les outils de supervision simples.

Chaque reponse HTTP expose un en-tete `X-Request-Id`. Le conserver dans les journaux et les demandes de support afin de relier un incident a une requete sans consigner de document ou de donnees personnelles.

## Variables de production requises

- `NODE_ENV=production`
- `DATABASE_URL`
- `APP_URL`, avec l'URL publique de l'application web
- `API_URL`, avec l'URL publique de l'API
- `SESSION_SECRET`, aleatoire et d'au moins 32 caracteres
- `DOCUMENT_ENCRYPTION_SECRET`, aleatoire et d'au moins 32 caracteres
- `DOCUMENT_STORAGE_DIR` seulement pour une instance locale de demonstration

Ne jamais reutiliser les valeurs de `.env.example` en production. Les secrets de session et de chiffrement sont volontairement refuses au demarrage quand ils sont insuffisants.

## Regles reseau

- L'API n'accepte les requetes navigateur que depuis les origines declarees dans `APP_URL`, separees par des virgules.
- Definir `TRUST_PROXY=true` uniquement lorsque l'API est derriere un proxy de confiance qui renseigne correctement l'adresse IP cliente.
- Les endpoints d'inscription, de connexion et de depot sont limites a 20 requetes par minute et par adresse IP sur une instance. Un deploiement multi-instance devra remplacer ce limiteur local par Redis.

## Sauvegarde et restauration

- Sauvegarder PostgreSQL quotidiennement et verifier mensuellement une restauration sur un environnement isole.
- Conserver les documents chiffres dans un stockage objet distinct de la base, avec versioning et politique de retention.
- Tester toute rotation de `DOCUMENT_ENCRYPTION_SECRET` sur une copie des donnees: les documents existants doivent rester dechiffrables par une cle de transition.

## Avant ouverture au public

- Configurer une surveillance de `/health/ready`, des erreurs API et des echecs de taches OCR/IA.
- Verifier la restauration PostgreSQL et l'acces aux objets chiffres.
- Realiser un test de charge des depots et un test d'intrusion cible sur authentification, documents et paiement.
- Valider les durées de conservation et le traitement des demandes de suppression avec le conseil juridique.
