# Déploiement Lydoc

## Profil de bêta publique gratuite

Le premier déploiement public utilise `LYDOC_DEPLOYMENT_PROFILE=free-beta`. L’OCR Mistral et la génération gratuite du dossier restent disponibles. Le paiement, l’impression et l’envoi postal géré restent désactivés côté API et navigateur avec :

```dotenv
MANAGED_POSTAL_ENABLED=false
NEXT_PUBLIC_MANAGED_POSTAL_ENABLED=false
NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED=false
POSTAL_PROVIDER=mock
SERVICE_POSTAL_PRODUCTION_ENABLED=false
```

La page client « Mes factures » est masquée tant que
`NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED=false`. Pour la réintégrer, passez cette
valeur à `true`, puis reconstruisez et redéployez l’image Web : les variables
`NEXT_PUBLIC_*` sont intégrées au bundle Next.js lors du build.

Le support public, lui, reste opérationnel : `RESEND_API_KEY`, `RESEND_FROM_EMAIL` et `CONTACT_TO_EMAIL` sont obligatoires même si `NOTIFICATIONS_REQUIRED=false`. Les limites globales, par e-mail et par client (`CONTACT_DAILY_*` et `CONTACT_HOURLY_*`) doivent rester explicites et bornées.

## Architecture réseau

Par défaut, Compose publie Web et API uniquement sur la boucle locale :

- `127.0.0.1:3000` pour Web ;
- `127.0.0.1:3001` pour l’API ;
- aucun port hôte pour PostgreSQL, qui reste sur le réseau Docker interne `data`.

Un proxy TLS sur l’hôte publie les domaines HTTPS et transfère vers ces deux ports. La production exige `TRUST_PROXY=true` et une liste de 1 à 16 hôtes exacts dans `TRUST_PROXY_CIDRS` : adresse seule, IPv4 `/32` ou IPv6 `/128`. Les sous-réseaux privés larges et les plages universelles sont refusés. Cette contrainte permet à Express d’accepter `X-Forwarded-For` uniquement depuis le proxy réel ; sans elle, tous les visiteurs partageraient l’adresse de la passerelle et pourraient épuiser ensemble `API_GENERAL_RATE_LIMIT_PER_MINUTE`.

Après création du réseau Compose et avant le préflight, relevez la passerelle exacte du réseau `edge` (remplacez `lydoc` si `LYDOC_COMPOSE_PROJECT_NAME` diffère) :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml create postgres
docker network inspect lydoc_edge `
  --format "{{range .IPAM.Config}}{{println .Gateway}}{{end}}"
```

Placez l’adresse IPv4 obtenue avec `/32` — ou l’adresse IPv6 avec `/128` — dans `TRUST_PROXY_CIDRS`, puis vérifiez après un appel via Nginx que les journaux API attribuent la requête à l’IP cliente transmise. N’ajoutez jamais le sous-réseau Docker complet. Si le proxy est déplacé vers un conteneur, assignez-lui une adresse stable dédiée et ne faites confiance qu’à cette adresse.

Le modèle [nginx-lydoc.conf.example](../deploy/nginx-lydoc.conf.example) fournit les plafonds généraux et upload, la limitation de connexions, des délais courts et surtout le buffering complet des uploads avant Node. Remplacez les domaines et chemins de certificats, placez-le dans le contexte `http {}`, validez avec `nginx -t`, puis testez depuis Internet. Le limiteur en mémoire de l’API constitue une seconde barrière ; il ne remplace ni le proxy ni, en cas de plusieurs réplicas, un quota distribué.

Si le proxy est lui-même dans Compose, rattachez-le au réseau `edge`, retirez les publications de ports et ciblez `web:3000` et `api:3001`.

## Pré-requis

- Docker Engine et Docker Compose récents, avec au moins 4 Go de RAM ;
- deux noms DNS, certificats TLS et un proxy correctement durci ;
- un domaine Resend vérifié et des adresses dédiées au support et à la sécurité ;
- une clé Mistral et les accords de sous-traitance nécessaires au traitement OCR ;
- un stockage hors hôte versionné pour les sauvegardes chiffrées ;
- un gestionnaire de secrets distinct du stockage des sauvegardes.

## Configuration

Copiez l’exemple sans le committer :

```powershell
Copy-Item deploy/production.env.example .env.production
```

Remplacez tous les placeholders. Utilisez des secrets aléatoires distincts pour PostgreSQL, les sessions, l’outbox d’identité, le MFA administrateur, les documents et les sauvegardes. Les secrets d’outbox, MFA, documents et sauvegardes doivent avoir au moins 32 caractères et ne doivent jamais être identiques entre eux ni au secret de session.

Les identifiants de clés sont stables et non secrets :

```dotenv
DOCUMENT_ENCRYPTION_KEY_ID=primary-2026-08
MFA_ENCRYPTION_KEY_ID=admin-mfa-2026-08
BACKUP_ENCRYPTION_KEY_ID=backups-2026-08
```

`NEXT_PUBLIC_APP_URL` doit être égal à `APP_URL`, et `NEXT_PUBLIC_API_URL` à `API_URL`. `SECURITY_CONTACT_EMAIL` alimente le fichier public `security.txt`. Ces valeurs non secrètes sont intégrées à l’image Web au build. Le fichier de production complet n’est jamais injecté dans Web.

Compose transmet uniquement `DATABASE_URL` au service de migration. L’API reçoit sa configuration serveur, mais Compose y écrase explicitement `BACKUP_ENCRYPTION_SECRET` et `BACKUP_ENCRYPTION_PREVIOUS_KEYS` : les clés de sauvegarde restent disponibles uniquement sur l’hôte opérateur.

## Contrôle bloquant et démarrage

Exécutez le préflight :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/preflight-production.ps1 `
  -EnvironmentFile .env.production
```

Il refuse notamment les placeholders, les secrets courts ou réutilisés, une clé MFA ou d’outbox non dédiée, l’exposition de jetons de test, un TTL de session administrateur trop long, les bornes de worker/budgets identité invalides, les URL non HTTPS, les adresses invalides, un bind public implicite, `TRUST_PROXY=false` ou un proxy autre qu’un hôte exact, une rétention automatique désactivée, des quotas hors limites (comptes, concurrence Mistral, uploads en attente et TTL des réservations d’écriture) ou l’activation d’une fonction payante dans le profil gratuit.

Construisez et démarrez :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

Le service one-shot `migrate` attend PostgreSQL et exécute `prisma migrate deploy`. L’API démarre uniquement après son succès. API, Web et migration sont non-root, sans capacités Linux, avec système de fichiers en lecture seule et limites CPU, mémoire et PID. Les seules écritures runtime autorisées sont les volumes et `tmpfs` déclarés. Les images Node, PostgreSQL et les utilitaires opérateur sont figées par digest; renouvelez ces digests dans une PR dédiée après scan et tests, jamais automatiquement en production.

Avant d’exposer le proxy, inscrivez et vérifiez une adresse d’administrateur, puis provisionnez hors bande son TOTP :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml run --rm --build admin-provision --email admin@example.org
```

Le conteneur one-shot rejoint le réseau PostgreSQL interne sans publier la base ni copier son mot de passe dans une ligne de commande. Le secret et l’URI ne sont affichés qu’à cette exécution. La commande est transactionnelle, révoque les sessions et écrit un événement d’audit sans le secret. Utilisez `--rotate` uniquement pour une rotation explicite d’un administrateur existant. Il n’existe pas de `ADMIN_EMAILS` ni de promotion via l’API publique.

Web démarre sur la boucle locale dès que le processus API est lancé, même si sa readiness attend encore un premier règlement approuvé. Laissez le proxy public fermé, connectez cet administrateur via `http://127.0.0.1:3000`, chargez et faites valider la règle initiale, puis exigez un `200` sur `/health/ready` avant toute exposition. Ce bootstrap n’affaiblit ni le signal de readiness ni l’isolation réseau.

Vérifiez ensuite :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
Invoke-WebRequest http://127.0.0.1:3001/health/live
Invoke-WebRequest http://127.0.0.1:3001/health/ready
Invoke-WebRequest http://127.0.0.1:3000/
```

`/health/live` vérifie uniquement le processus. `/health/ready` valide la configuration, PostgreSQL et l’écriture dans le volume documentaire. Les probes de dépendances concurrentes partagent une promesse et sont mises en cache dix secondes, afin que la supervision ne devienne pas un amplificateur de charge.

## Sauvegarde authentifiée

La sauvegarde découvre le vrai volume monté sur `/app/var/storage` et refuse de créer une sauvegarde dite complète si ce volume est absent ou s’il manque un seul objet référencé par PostgreSQL. Un volume vide n’est accepté qu’après arrêt des écritures et confirmation qu’aucun objet `Document`, révision active, paquet généré ou job de purge en attente n’est attendu. Cette décision, le nombre de références, de fichiers archivés et d’éventuels orphelins sont inscrits dans le manifeste. Elle place API/Web en maintenance pendant le dump et l’archivage, puis redémarre uniquement les services qui étaient actifs. Cette courte interruption garantit que la base et les fichiers appartiennent au même état applicatif. Elle chiffre et authentifie ensuite les deux artefacts en AES-256-GCM avec une clé dérivée par scrypt. Les fichiers temporaires en clair sont supprimés avant la création du manifeste version 4, marqué `application-writes-stopped`; le vérificateur conserve la lecture des manifestes version 3 antérieurs.

```powershell
powershell -ExecutionPolicy Bypass -File scripts/backup-lydoc.ps1 `
  -EnvironmentFile .env.production

powershell -ExecutionPolicy Bypass -File scripts/verify-backup.ps1 `
  -BackupDirectory var/backups/<horodatage> `
  -EnvironmentFile .env.production

powershell -ExecutionPolicy Bypass -File scripts/verify-backup.ps1 `
  -BackupDirectory var/backups/<horodatage> `
  -EnvironmentFile .env.production `
  -TestRestore
```

`-TestRestore` contrôle les hashes, authentifie et déchiffre les artefacts dans un répertoire temporaire, restaure PostgreSQL et les documents dans des ressources Docker isolées, puis supprime ces ressources. Il recalcule aussi le nombre d’objets attendus depuis la base restaurée et vérifie qu’une archive déclarée vide l’est réellement. Les conteneurs opérateur sont épinglés par digest, privés de réseau, en lecture seule, sans privilèges ni capacités sauf `CHOWN` lors de l’extraction vers le volume identifié, et limités en ressources. Le conteneur qui reçoit la clé de sauvegarde est toujours non-root et sans réseau. Exécutez le test régulièrement depuis l’hôte de secours.

Copiez les artefacts déjà chiffrés hors de l’hôte avec contrôle d’accès, versionnement et rétention indépendante. Conservez `BACKUP_ENCRYPTION_SECRET` dans un gestionnaire de secrets séparé. Sans cette clé, la sauvegarde est irrécupérable.

## Restauration

Une restauration réelle remplace les données et exige un consentement explicite :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/restore-lydoc.ps1 `
  -BackupDirectory var/backups/<horodatage> `
  -EnvironmentFile .env.production `
  -ConfirmRestore
```

Le script vérifie et authentifie d’abord les deux artefacts, arrête API/Web, restaure PostgreSQL dans une transaction et remplit le volume documentaire identifié, puis redémarre la pile. En cas d’échec, API/Web restent arrêtés. `-DatabaseOnly` et `-DocumentsOnly` sont réservés à une procédure d’incident documentée.

## Rotation des clés

Pour les documents, placez la nouvelle clé dans `DOCUMENT_ENCRYPTION_SECRET`, changez `DOCUMENT_ENCRYPTION_KEY_ID` et conservez temporairement les anciennes dans `DOCUMENT_ENCRYPTION_PREVIOUS_KEYS` sous forme de JSON compact. Ne retirez une ancienne clé qu’après migration de tous les objets et restauration testée.

Pour la clé qui chiffre les secrets MFA, placez l’ancienne paire dans `MFA_ENCRYPTION_PREVIOUS_KEYS`, déployez la nouvelle paire courante, puis reprovisionnez explicitement chaque administrateur avec `docker compose --env-file .env.production -f docker-compose.production.yml run --rm --build admin-provision --email admin@example.org --rotate`. Ne retirez l’ancienne clé qu’après rotation de tous les administrateurs et vérification de leur connexion. La rotation d’un secret TOTP révoque toutes les sessions du compte.

Pour `IDENTITY_OUTBOX_ENCRYPTION_SECRET`, arrêtez brièvement les nouvelles inscriptions, laissez l’outbox se vider et vérifiez l’absence de dead letters avant rotation. Les messages encore chiffrés avec l’ancienne valeur deviendraient indéchiffrables; les jetons ont une durée maximale de 24 heures et peuvent être réémis après rotation.

La rotation des sauvegardes est indépendante. Changez `BACKUP_ENCRYPTION_SECRET` et `BACKUP_ENCRYPTION_KEY_ID`, puis conservez les anciennes valeurs dans `BACKUP_ENCRYPTION_PREVIOUS_KEYS` jusqu’à expiration des sauvegardes correspondantes. Ne copiez jamais ces secrets dans la documentation, les journaux ou une variable `NEXT_PUBLIC_*`.

## Passage au profil complet

Avant d’activer `LYDOC_DEPLOYMENT_PROFILE=full` et le postal géré :

- validez Stripe en mode réel et son webhook ;
- validez les autres notifications Resend puis passez `NOTIFICATIONS_REQUIRED=true` ;
- terminez un parcours Service Postal sandbox avec signature de webhook, délais et reprises ;
- conservez `SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN=false` ;
- activez explicitement les indicateurs serveur et navigateur, reconstruisez Web, puis relancez le préflight avec `-ExpectedProfile full` ;
- effectuez un unique envoi réel vers une adresse interne avant toute ouverture.

## Limite d’architecture

Le volume documentaire est attaché à une seule instance API. Ne lancez pas plusieurs réplicas tant qu’un stockage partagé, versionné et chiffré ainsi qu’un rate limiter distribué ne sont pas validés.
