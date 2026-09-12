# Exploitation Lydoc

## Supervision

- `GET /health/live` confirme que le processus API répond, sans dépendre de PostgreSQL.
- `GET /health/ready` confirme la configuration de production, PostgreSQL et l’écriture dans le volume documentaire.
- `GET /health` fournit le même contrôle synthétique avec quelques métadonnées de service.

Les deux contrôles de dépendances partagent une probe mise en cache dix secondes, et les échecs deux secondes. Surveillez `/health/ready` depuis le réseau de supervision ou au travers d’un proxy qui applique un quota dédié. Chaque réponse HTTP comporte `X-Request-Id`; conservez-le pour corréler les incidents sans journaliser de PII ni de contenu documentaire.

## Variables obligatoires de la bêta publique

- `NODE_ENV=production` et `LYDOC_DEPLOYMENT_PROFILE=free-beta` ;
- `DATABASE_URL`, `APP_URL`, `API_URL`, `NEXT_PUBLIC_APP_URL` et `NEXT_PUBLIC_API_URL` ;
- `SESSION_SECRET`, aléatoire et d’au moins 32 caractères ;
- `IDENTITY_OUTBOX_ENCRYPTION_SECRET`, secret dédié d’au moins 32 caractères, distinct des secrets session, MFA, documents et sauvegardes ;
- `MFA_ENCRYPTION_SECRET`, secret dédié d’au moins 32 caractères, `MFA_ENCRYPTION_KEY_ID` et, pendant une rotation de clé, `MFA_ENCRYPTION_PREVIOUS_KEYS` ;
- `ADMIN_SESSION_TTL_MINUTES`, `AUTH_SCRYPT_CONCURRENCY`, `AUTH_SCRYPT_QUEUE_LIMIT`, les budgets persistants globaux et par identifiant `AUTH_*_LIMIT`, `AUTH_DISPATCH_MIN_RESPONSE_MS` et les délais `AUTH_PENDING_USER_TTL_HOURS` / `AUTH_CLEANUP_INTERVAL_MINUTES` ;
- `API_GENERAL_RATE_LIMIT_PER_MINUTE`, plafond général par IP explicite et borné ;
- les bornes du worker `IDENTITY_EMAIL_OUTBOX_INTERVAL_MS`, `IDENTITY_EMAIL_OUTBOX_CONCURRENCY`, `IDENTITY_EMAIL_OUTBOX_BATCH_SIZE`, `IDENTITY_EMAIL_OUTBOX_LEASE_SECONDS` et `IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS` ;
- `DOCUMENT_ENCRYPTION_SECRET`, `DOCUMENT_ENCRYPTION_KEY_ID` et, pendant une rotation, `DOCUMENT_ENCRYPTION_PREVIOUS_KEYS` ;
- `BACKUP_ENCRYPTION_SECRET`, distinct de la clé documentaire, `BACKUP_ENCRYPTION_KEY_ID` et, pendant une rotation, `BACKUP_ENCRYPTION_PREVIOUS_KEYS` ;
- `MISTRAL_API_KEY`, `AI_DAILY_ACCOUNT_CALL_LIMIT` et `MISTRAL_DAILY_CALL_LIMIT` pour l'import automatisé des règlements de jeux ; aucun document client n'est transmis à Mistral ;
- `DOCUMENT_STORAGE_GLOBAL_BYTES` borne durablement les documents, leurs révisions et les dossiers PDF générés ; `DOCUMENT_STORAGE_MIN_FREE_BYTES` réserve en plus un plancher d'espace libre ; `STORAGE_WRITE_RESERVATION_TTL_SECONDS` borne à 60–3 600 secondes les réservations d’écriture à réconcilier après interruption. Reliez ces signaux à la supervision du volume ;
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_TO_EMAIL`, `CONTACT_DAILY_LIMIT` et `SECURITY_CONTACT_EMAIL` ;
- `DOCUMENT_RETENTION_DAYS`, `SENSITIVE_DOCUMENT_RETENTION_DAYS`, `DOCUMENT_DELETION_GRACE_DAYS`, `DOCUMENT_MIGRATION_BACKUP_DAYS`, `DOCUMENT_RETENTION_AUTOMATION_ENABLED=true`, `DOCUMENT_RETENTION_INTERVAL_MINUTES`, `ACCOUNT_ERASURE_PURGE_GRACE_DAYS` et `ACCOUNT_LEGAL_RECORD_RETENTION_DAYS` ;
- `MANAGED_POSTAL_ENABLED=false`, `NEXT_PUBLIC_MANAGED_POSTAL_ENABLED=false`, `NEXT_PUBLIC_DOCUMENTS_PAGE_ENABLED=false`, `POSTAL_PROVIDER=mock` et `SERVICE_POSTAL_PRODUCTION_ENABLED=false`.

Les valeurs initiales sont `CONTACT_DAILY_LIMIT=200`, `CONTACT_DAILY_EMAIL_LIMIT=3`, `CONTACT_DAILY_CLIENT_LIMIT=20`, `CONTACT_HOURLY_ATTEMPT_LIMIT=400`, `CONTACT_HOURLY_EMAIL_ATTEMPT_LIMIT=10` et `CONTACT_HOURLY_CLIENT_ATTEMPT_LIMIT=40`. Les e-mails d’inscription, de renvoi et de mot de passe oublié partagent en plus un budget journalier persistant, un budget horaire par action et un budget par identifiant haché. Les challenges MFA administrateur ont leurs propres budgets persistants. Les routes publiques ne contactent jamais Resend : elles créent transactionnellement un message chiffré, puis un worker borné effectue les reprises avec une clé d’idempotence stable et place les échecs définitifs en dead letter. Surveillez `IDENTITY_EMAIL_DEAD_LETTERED`. Le préflight applique les mêmes bornes que l’API. `AUTH_EXPOSE_TEST_TOKENS=false` est impératif. `NOTIFICATIONS_REQUIRED=false` rend optionnelles les autres notifications, jamais le formulaire de support. Ne réutilisez aucune valeur d’exemple en production.

## Provisionnement et rotation d’un administrateur

Il n’existe aucune élévation par variable d’environnement ni par inscription publique. Créez d’abord un compte `USER` par le parcours normal et vérifiez réellement son adresse e-mail. Depuis l’hôte opérateur, lancez ensuite le conteneur one-shot relié au réseau PostgreSQL interne :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml run --rm --build admin-provision --email admin@example.org
```

La commande refuse une adresse non vérifiée et un administrateur déjà actif. Elle génère un secret TOTP aléatoire, le chiffre en AES-256-GCM avec la clé MFA dédiée, élève le compte dans une transaction, révoque toutes ses sessions et challenges MFA, puis écrit `ADMIN_MFA_PROVISIONED` dans `AuditLog`. Le secret et l’URI `otpauth://` sont affichés une seule fois : scannez-les immédiatement depuis un poste de confiance, confirmez un premier code avant publication et ne les copiez ni dans un ticket ni dans un journal.

Pour une rotation explicitement autorisée :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml run --rm --build admin-provision --email admin@example.org --rotate
```

La rotation exige un administrateur MFA déjà actif, révoque encore toutes ses sessions, remet l’anti-rejeu TOTP à zéro et journalise `ADMIN_MFA_ROTATED`. Toute session administrateur a un TTL court, n’est créée qu’après le second facteur et reste refusée par `AdminGuard` si la preuve MFA manque. Une migration de sécurité rétrograde les anciens comptes `ADMIN` sans MFA : reprovisionnez-les explicitement avec cette procédure.

Au premier déploiement, l’API peut être vivante mais non prête tant qu’aucune règle de jeu n’est approuvée. Gardez le proxy public fermé, provisionnez l’administrateur, connectez-vous par l’accès local de maintenance, approuvez la première règle, puis exigez `/health/ready=200` avant d’ouvrir le proxy.

## Cutover des anciens PDF générés

La migration qui introduit `GeneratedPacket.sizeBytes` ne peut pas lire le volume chiffré depuis PostgreSQL. La readiness refuse donc tout trafic tant qu’au moins une ancienne ligne porte une taille nulle ou négative. Gardez le proxy fermé et commencez par cette détection non-PII :

```sql
SELECT COUNT(*) AS invalid_generated_packets
FROM "GeneratedPacket"
WHERE "sizeBytes" <= 0;
```

Si le compteur est non nul, arrêtez l’API pendant le cutover puis lancez d’abord le service opérateur en mode audit, sans écriture PostgreSQL et avec le volume documentaire monté en lecture seule :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml --profile operator run --rm --build generated-packet-backfill
```

Le script déchiffre chaque paquet uniquement en mémoire avec son contexte propriétaire/dossier, recalcule son SHA-256 et sa taille exacte, et sort avec le code 2 tant qu’un backfill reste nécessaire. Après vérification du rapport, appliquez les mises à jour compare-and-swap sous verrou de dossier :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml --profile operator run --rm --build generated-packet-backfill --apply
```

Le profil one-shot utilise le réseau PostgreSQL interne et le volume nommé de production ; ni la base ni le volume n’ont besoin d’être exposés à l’hôte. Les secrets de sauvegarde sont explicitement retirés de son environnement. Même en mode `--apply`, le volume reste en lecture seule : seules la taille exacte et l’entrée d’audit sont écrites dans PostgreSQL. Chaque correction est journalisée par `GENERATED_PACKET_SIZE_BACKFILLED`. Le script refuse d’écrire si l’objet, son contexte ou son checksum ne correspondent pas. Dans ce cas, restaurez d’abord l’objet depuis une sauvegarde authentifiée testée, puis relancez l’audit. Si la restauration est impossible, programmez sa purge par l’outbox de rétention et régénérez le dossier par le flux applicatif ; ne supprimez jamais directement la ligne SQL ou le blob. Avant d’ouvrir le proxy, exigez simultanément : compteur SQL à zéro, commande `--apply` sans échec, rétention sans job en erreur et `/health/ready=200`.

## Proxy et limites de requêtes

L’API n’accepte les requêtes navigateur que depuis `APP_URL`. Gardez `LYDOC_BIND_ADDRESS=127.0.0.1` tant qu’un proxy hôte publie le service. La production exige `TRUST_PROXY=true` et 1 à 16 hôtes exacts dans `TRUST_PROXY_CIDRS` (adresse seule, IPv4 `/32` ou IPv6 `/128`). Relevez la passerelle avec `docker network inspect <projet>_edge`, ne faites jamais confiance au sous-réseau Docker complet et revérifiez cette adresse après toute modification réseau.

Le plafond général par IP couvre toutes les routes hors `/health/live` et `/health/ready`, puis les chemins sensibles reçoivent un quota supplémentaire. Ces chemins sont normalisés et leurs identifiants variables sont canonisés afin que casse, slash final, encodage ou rotation d’identifiant ne contournent pas leur quota. Ces limiteurs en mémoire complètent la limitation du proxy et les budgets persistants ; ils ne les remplacent pas. Ils restent locaux à une instance. Un déploiement multi-instance doit utiliser un stockage de quotas partagé, par exemple Redis.

## Import des règlements, quotas et confidentialité

Les factures opérateur ne sont pas analysées automatiquement : le client saisit le nombre de SMS et le montant total, puis la facture reste stockée comme justificatif chiffré. Mistral est réservé à l’OCR et à l’extraction des règlements importés par l’administration. Les limites quotidiennes doivent être dimensionnées et surveillées pour éviter les abus et les dépassements de coût.

Les documents clients, notamment les factures, RIB et pièces d’identité, ne doivent jamais être envoyés au fournisseur IA. Les documents sensibles sont filigranés localement lorsque la fonction est active et tous sont stockés chiffrés. Les durées de rétention et le traitement des règlements doivent figurer dans la politique de confidentialité et les accords de sous-traitance.

## Rétention documentaire

La production exige `DOCUMENT_RETENTION_AUTOMATION_ENABLED=true`. Surveillez chaque exécution et alertez sur les échecs. La valeur `SENSITIVE_DOCUMENT_RETENTION_DAYS` couvre les paquets contenant des documents sensibles; elle doit être validée juridiquement avec les autres délais.

Testez mensuellement les demandes de suppression, la purge après délai de grâce et la lisibilité des objets restants. Toute rotation de clé documentaire doit être testée sur une copie avant retrait d’une ancienne clé.

`GET /auth/account/export` fournit un export JSON paginé (`resource=profile|documents|cases|notifications|audit`, `limit<=100`). `POST /auth/account/delete` exige le mot de passe courant, bloque les administrateurs, révoque les sessions et jetons, efface les données OCR/analytiques dérivées, pseudonymise le profil et programme la purge physique des objets. La suppression refuse temporairement un dossier ayant un paiement `PENDING` ou un envoi `SUBMITTING`, afin de ne pas perdre la réconciliation d’un effet externe irréversible. Les documents sans historique financier ou postal utilisent `ACCOUNT_ERASURE_PURGE_GRACE_DAYS`; seuls les documents liés à un paiement payé/remboursé ou à un envoi effectivement soumis suivent `ACCOUNT_LEGAL_RECORD_RETENTION_DAYS`, calculé depuis l’événement juridique d’origine et non depuis la demande d’effacement. Les paquets gratuits, sans base transactionnelle ou déjà arrivés à échéance sont placés immédiatement dans l’outbox de purge ; les paquets encore requis par une transaction ou un envoi conservent dans l’audit une base explicite et leur échéance calculée avec `SENSITIVE_DOCUMENT_RETENTION_DAYS`. Les métadonnées d’audit historiques liées au compte, à ses dossiers et documents sont expurgées des noms, adresses et identifiants propriétaire, sans supprimer les montants, statuts ni bases légales. `ACCOUNT_LEGAL_RECORD_RETENTION_DAYS` et sa base légale doivent être validés par le conseil compétent avant ouverture. L’audit `ACCOUNT_ERASURE_PSEUDONYMIZED_AND_PURGE_SCHEDULED` n’atteste pas encore la purge physique : surveillez ensuite les jobs de purge et les événements `DOCUMENT_PHYSICALLY_PURGED` et `GENERATED_PACKET_PHYSICALLY_PURGED`.

## Service Postal et webhooks

La bêta gratuite conserve `POSTAL_PROVIDER=mock`. Avant le profil complet, configurez les limites de délai et de reprises du fournisseur, la tolérance d’horodatage du webhook et un secret d’au moins 24 caractères. Conservez impérativement :

```dotenv
SERVICE_POSTAL_ALLOW_LEGACY_WEBHOOK_TOKEN=false
SERVICE_POSTAL_WEBHOOK_TOLERANCE_SECONDS=300
SERVICE_POSTAL_REQUEST_TIMEOUT_MS=10000
SERVICE_POSTAL_REQUEST_MAX_ATTEMPTS=2
```

Validez d’abord la signature HMAC et la protection anti-rejeu en sandbox. Un courrier réel n’est validé chez le prestataire qu’après confirmation du paiement Stripe.

## Sauvegarde et restauration

- Exécutez `pnpm backup` chaque jour sur l’hôte opérateur, dans une fenêtre de maintenance : le script arrête temporairement API/Web pour figer les écritures, puis relance seulement les services initialement actifs.
- Le script refuse un volume documentaire absent. Il n’accepte une archive vide que si PostgreSQL confirme zéro objet attendu ; le manifeste enregistre cette décision et `-TestRestore` la recalcule depuis la base restaurée.
- Le dump et l’archive sont chiffrés et authentifiés en AES-256-GCM avec scrypt; le manifeste courant est en version 4 et inventorie les objets attendus, archivés et orphelins (la vérification reste compatible avec la version 3).
- Toute valeur `documentArchive.unreferencedObjectFiles` supérieure à zéro déclenche une investigation : conservez l'archive, comparez les audits et jobs de purge, puis réconciliez l'objet chiffré hors bande. Ne supprimez jamais un orphelin présumé avant d'avoir vérifié les sauvegardes et les références PostgreSQL.
- Tous les utilitaires Docker sont épinglés par digest, sans réseau, avec racine en lecture seule, capacités supprimées et limites de ressources. Le chiffrement s’exécute non-root; la seule capacité réintroduite est `CHOWN` pour restaurer les propriétaires du volume documentaire.
- Vérifiez chaque sauvegarde avec `scripts/verify-backup.ps1 -EnvironmentFile .env.production`.
- Effectuez régulièrement un `-TestRestore` réel et isolé depuis l’hôte de secours.
- Copiez les artefacts hors hôte avec versionnement et rétention, mais stockez les clés ailleurs.
- Utilisez `scripts/restore-lydoc.ps1 ... -ConfirmRestore` seulement après validation; les services restent arrêtés si la restauration est partielle.

Pour faire tourner la clé de sauvegarde, changez la clé et son identifiant courants, puis gardez les anciennes entrées dans `BACKUP_ENCRYPTION_PREVIOUS_KEYS` jusqu’à expiration des artefacts concernés. Testez une restauration avant toute suppression de clé.

## Réponse aux incidents

1. Retirez l’instance du proxy public sans supprimer volumes ni journaux.
2. Conservez les identifiants de requêtes, horaires, versions d’images et événements d’audit, sans exporter de PII inutile.
3. Révoquez les sessions et clés fournisseur concernées, puis remplacez les secrets compromis.
4. Vérifiez l’intégrité et restaurez uniquement depuis une sauvegarde authentifiée testée.
5. Documentez l’impact, les personnes concernées et les obligations de notification RGPD.

## Contrôle avant ouverture

- préflight réussi avec le fichier réel de production ;
- CI verte : migrations sur PostgreSQL neuf, types, lint, tests, build et audit npm au niveau `moderate` ;
- CodeQL et Gitleaks sans alerte non traitée ;
- images non-root et read-only, SBOM générés, Trivy sans vulnérabilité High/Critical ;
- restauration complète testée depuis une copie hors hôte ;
- cutover `GeneratedPacket.sizeBytes` terminé, compteur invalide à zéro et readiness verte ;
- au moins deux administrateurs MFA distincts provisionnés, procédure hors bande de rotation/reprise testée et sessions antérieures révoquées ;
- supervision, alertes de quotas d’import des règlements et de rétention opérationnelles ;
- tests d’intrusion externes ciblés sur identité, autorisations documentaires, upload, SSRF, injections et webhooks ;
- mentions légales, confidentialité, CGU et processus RGPD validés par le conseil compétent.
