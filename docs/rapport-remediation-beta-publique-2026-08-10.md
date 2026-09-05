# Rapport final de remédiation — bêta publique gratuite Lydoc

Date de clôture technique : 10 août 2026  
Périmètre : API NestJS, Web Next.js, PostgreSQL/Prisma, documents et IA, identité/RGPD, paiements et envoi postal, Docker/CI, sauvegarde/restauration et préparation de mise en production.

## Décision exécutive

**Décision actuelle : NO-GO pour une ouverture publique immédiate.**

Le dépôt a été transformé en **candidat de release techniquement durci** pour le profil gratuit. Les suites automatisées, le typage, le lint, Prisma et les migrations sont verts. Les fonctions payantes restent désactivées. Les défauts critiques trouvés pendant l’audit — authentification administrateur, concurrence paiement/remboursement, exfiltration possible d’un document sensible vers l’IA, quotas de stockage, effacement RGPD concurrent, bootstrap, migrations et sauvegardes — ont reçu des correctifs.

Le NO-GO ne vient plus d’un défaut fonctionnel connu dans les suites automatisées. Il reste motivé par des prérequis impossibles à fabriquer dans le code et par des validations de production qui doivent encore être exécutées sur l’environnement réel : identité légale de l’éditeur, hébergeur/région et contrats, DNS/TLS, fournisseurs réels, premier règlement approuvé, corpus de factures Orange anonymisées, restauration hors hôte, supervision et test dynamique de l’image finale.

## Résultat des contrôles

| Contrôle | Résultat final |
| --- | --- |
| Tests monorepo | **189/189 réussis** : config 3, Web 4, application 23, infrastructure 20, API 139 |
| TypeScript | Tous les workspaces passent le typecheck |
| ESLint | Tous les workspaces passent ; Web couvre désormais `app`, `components` et `lib` |
| Prisma | `validate` et `generate` réussis |
| PostgreSQL vierge | **13 migrations**, statut à jour, `migrate diff`: aucune dérive |
| Base de test existante | migrations réparées/appliquées, statut à jour, aucune dérive |
| Préflight production | test avec environnement jetable valide et Compose : réussi |
| PowerShell | analyse syntaxique des scripts critiques : réussie |
| Format/diff | Prettier release-critical et `git diff --check` : réussis |
| Dépendances pnpm | audit production et audit complet : aucune vulnérabilité connue après relock |
| Build Web Linux | compilation, types et génération de **28 pages** réussies dans Docker |
| Build API final | image créée : `sha256:575b09bc8008b9b6ef07659a6839bf45d614d1fdd70b292e6fc62119d49166b8` |
| Compose | configuration durcie et profil opérateur validés |

Le build Web local Windows atteint également la génération des 28 pages, puis échoue uniquement lors de la création de liens symboliques `.next/standalone` (`EPERM`). Le build Docker Linux constitue le contrôle canonique et passe.

Une contre-revue finale indépendante du snapshot n’a identifié aucun autre P0/P1 exploitable ni aucune régression bloquante dans le code. Elle a notamment revalidé le préflight 64 bits, les commits CI, le cutover des paquets et le confinement du service opérateur.

## Correctifs livrés

### 1. Identité, sessions et administration

- Sessions opaques conservées côté serveur ; seul un hash lié au secret de session est stocké.
- Rôle relu en base à chaque session, révocation d’une session ou de toutes les sessions.
- Cookies de production `__Host-`, `HttpOnly`, `Secure` et politique `SameSite` adaptée.
- CSRF double-submit signé, contrôle d’origine et code stable `CSRF_INVALID`; le Web ne rejoue plus un refus métier 403.
- Inscription en état non vérifié, consentement légal versionné, vérification e-mail atomique et mot de passe inutilisable avant activation.
- Réinitialisation et changement de mot de passe à usage unique avec révocation des sessions.
- Réponses génériques et budgets persistants contre l’énumération ; envoi e-mail déplacé dans une outbox chiffrée asynchrone.
- Worker d’outbox borné : leases, `SKIP LOCKED`, idempotence fournisseur, reprises exponentielles, dead-letter et audit.
- MFA TOTP obligatoire pour les administrateurs : secret AES-GCM dédié, challenge court, cinq essais atomiques, anti-rejeu et sessions admin courtes.
- Provisionnement/rotation admin hors bande par service Compose one-shot, sans promotion via l’API publique.
- Parcours Web MFA implémenté.

### 2. Droits RGPD et minimisation

- Export de compte JSON paginé et borné, accessible depuis le profil Web.
- Suppression de compte protégée par mot de passe, refusée pour un administrateur et temporairement bloquée pendant les effets externes `PENDING`/`SUBMITTING`.
- Verrous profil/dossiers/documents et barrières DB contre les courses entre effacement, mise à jour, upload ou téléchargement.
- Révocation sessions/jetons, pseudonymisation du profil, suppression des OCR/analyses et expurgation des métadonnées personnelles connues.
- Tombstone et purge différée des documents/paquets ; rétention longue limitée aux dossiers payés/remboursés ou à un envoi réellement soumis.
- Les brouillons gratuits, simples paquets générés et paiements en attente ne déclenchent plus dix ans de conservation.
- Les audits d’accès facture ne recopient plus l’identifiant propriétaire ni le nom original du fichier.
- L’interface permet l’export et la suppression avec confirmation.

### 3. Documents, stockage et IA

- Validation magic bytes, tailles, noms, nombre de pages et dimensions ; rejet des polyglottes, actions PDF, formulaires, références externes et PostScript.
- CDR PDF/image, suppression de métadonnées et filigrane local des pièces sensibles avant chiffrement.
- Stockage AES-256-GCM lié au propriétaire/dossier/type et rotation de clés avec lecture des anciennes clés.
- Texte OCR sensible chiffré ; purge des dérivés avec le document.
- Le classifieur vulnérable fondé sur les octets bruts a été remplacé par un rendu local des pages puis OCR Tesseract avant toute transmission à Mistral.
- Détection locale des marqueurs RIB/IBAN/BIC, y compris espacés, et refus fail-closed si le rendu/OCR local est indisponible ou saturé.
- Le discours public a été aligné : la facture analysée est un PDF ; JPG/PNG restent possibles pour des pièces annexes.
- Limites de concurrence et délais sur rendu local, Mistral et OCR ; quotas quotidiens globaux et par compte.
- Réservations durables avant écriture, redimensionnées après CDR/filigrane ; budget global incluant documents, révisions, paquets et écritures en vol.
- Les tombstones comptent dans le quota jusqu’à la purge physique.
- Plancher d’espace disque `statfs`, limite globale durable et readiness correspondante.
- Sweeper borné pour les objets stockés dont la transaction de rattachement a échoué.

### 4. Cohérence métier et transactions

- Verrous canoniques et transitions compare-and-swap sur checkout Stripe, profil, paquets, documents et règles.
- Course `REFUNDED` contre webhook/paiement/envoi fermée ; un dossier remboursé/annulé ne peut plus être expédié.
- État `SUBMITTING` conservé en cas d’issue postale ambiguë afin de forcer la réconciliation.
- Idempotence Stripe et prestataire postal, signatures webhooks, fenêtre temporelle et reprises bornées.
- Règles métier versionnées ; édition, approbation, suppression et audit sont atomiques. Une version relue obsolète reçoit 409.
- Le Web administrateur transmet `expectedVersion` pour toutes les mutations.
- Purges et finalisations via outbox reprenable ; aucun I/O de stockage n’est lancé avant le commit de préparation.

### 5. HTTP, disponibilité et surface publique

- Limiteur général par IP, quotas renforcés sur les routes sensibles et buckets canoniques pour les identifiants variables.
- Les maps en mémoire restent bornées ; les budgets coûteux critiques sont persistants.
- `TRUST_PROXY=true` est obligatoire en production avec uniquement une adresse `/32` ou `/128` exacte.
- Cache court et ETag SHA-256 du catalogue public ; prise en charge correcte de `If-None-Match` et 304.
- Nginx exemple : TLS, limites de connexions/requêtes, délais courts et buffering complet d’upload avant Node.
- Corps JSON bornés et raw body réservé aux deux webhooks signés.
- En-têtes de sécurité/CSP, `robots.txt`, sitemap et `security.txt`.
- Readiness alignée sur le préflight, les binaires OCR, le volume, la base, un règlement utilisable et les invariants de migration.

### 6. Déploiement, migrations, sauvegardes et supply chain

- Docker Compose non-root, rootfs en lecture seule, `cap_drop: ALL`, `no-new-privileges`, tmpfs durcis et limites CPU/RAM/PID.
- PostgreSQL n’expose aucun port hôte ; Web/API sont publiés sur loopback pour le proxy TLS.
- Services one-shot internes pour migrations, provisionnement admin et backfill des anciens paquets.
- Environnements opérateurs réduits au strict nécessaire ; volume documentaire du backfill en lecture seule.
- `npm`, `npx`, Corepack, pnpm et Yarn sont supprimés des images d’exécution et de l’étage opérateur après build.
- CI : actions épinglées sur des commits, CodeQL, Gitleaks, SBOM, Trivy High/Critical, audit pnpm et contrôle de dérive Prisma.
- Le préflight valide les secrets, URL, proxy, fonctions gratuites/payantes, quotas, TTL, rétention et nombres 64 bits.
- Sauvegardes DB + volume arrêtent les écritures, inventorient toutes les références, détectent manquants/orphelins et autorisent un volume vide seulement si la base confirme zéro objet.
- Artefacts chiffrés/authentifiés séparément, manifeste v4 et vérification/restauration isolée ; compatibilité de lecture v3 conservée.
- Une ancienne ligne `GeneratedPacket.sizeBytes <= 0` met la readiness en échec. Le service opérateur vérifie déchiffrement et SHA-256 avant CAS/audit de la taille exacte.

## Tests de sécurité réalisés

### Tests automatisés et adversariaux

- Authentification : jetons malformés/expirés, session non vérifiée, reset à usage unique, révocation et dummy hash à travail constant.
- MFA : vingt soumissions concurrentes, cinq essais consommés exactement et verrouillage unique.
- CSRF : origine, cookie/header, signature, doubles slash/casse/encodage et exemptions webhook limitées.
- IDOR/effacement : compte supprimé contre profil, upload, génération et téléchargement de paquet.
- Concurrence : paiement, remboursement, checkout, envoi, purge, attachement, génération et approbation de règle.
- Upload : extension/MIME trompeurs, polyglottes, PDF actif, référence externe, annotations, limites, filigrane, chiffrement et échec de capacité.
- Stockage : traversée de chemin, bucket étranger, rotation de clé, tombstones, réservations, reprise d’orphelin et quota global.
- IA : tailles requête/réponse, timeout, quotas avant fournisseur et refus local de marqueurs sensibles.
- RGPD : pseudonymisation, maintien des seules valeurs de ledger nécessaires, échéance depuis l’événement juridique et export borné.
- Sauvegarde/migration : base vierge, absence de drift, inventaire volume vide/non vide et compatibilité du manifeste antérieur.

### Analyse de dépendances et d’images

L’audit pnpm initial a détecté puis fait corriger `nanoid`, `fast-uri` et `js-yaml`; les audits production et complet ont ensuite indiqué zéro vulnérabilité connue.

Un scan Trivy 0.73.0 de l’archive Web a trouvé un Critical et sept High uniquement dans le `npm` global de l’image Node (`tar`, `brace-expansion`, `ip-address`, `picomatch`, `sigstore`), pas dans l’application. Les outils de package inutiles ont été supprimés des étages finaux. Le scan final doit être rejoué par la CI sur les deux images reconstruites avant publication.

Les références Trivy de la CI ont aussi été corrigées pour viser les commits sous-jacents aux tags signés, à la suite de la vérification de l’avis officiel sur l’incident supply-chain 2026.

## Contrôles non terminés dans cet environnement

Ces contrôles sont **obligatoires avant ouverture**, même si le code automatisé est vert :

1. Reconstruction Web/API depuis un runner Linux propre, puis scan Trivy final sans High/Critical.
2. Probes de l’image API finale : UID non-root, rootfs réellement non inscriptible, absence des package managers, `pdftoppm` et langues Tesseract `fra+eng`.
3. PDF adversarial rendu de bout en bout dans l’image : IBAN/BIC visibles + faux texte de facture invisible doit être refusé ; facture visible propre doit être acceptée localement.
4. Parcours navigateur final : inscription, vérification, login, CSRF, MFA admin, règles CAS, export/suppression et responsive/clavier.
5. Scan dynamique ZAP baseline des deux domaines dans une préproduction isolée.
6. Tests avec vrais comptes sandbox Resend/Mistral, puis contrôle des journaux et des données reçues par les fournisseurs.
7. Test IDOR à deux comptes et campagne manuelle sur les endpoints déployés derrière le proxy réel.

La session locale ne pouvait plus lancer de processus en arrière-plan ni accéder au daemon Docker après l’épuisement du quota d’autorisation de l’environnement. Aucun résultat dynamique final n’est donc inventé.

Le même blocage a empêché le nettoyage final du conteneur PostgreSQL jetable `lydoc-remediation-postgres-20260810` et de deux répertoires temporaires sans données métier : `C:\Users\pjutg\AppData\Local\Temp\lydoc-trivy-20260810` et `C:\Users\pjutg\AppData\Local\Temp\lydoc-dynamic-20260810`. Ils peuvent être supprimés avec les commandes exactes suivantes dès que Docker et la suppression locale sont de nouveau autorisés :

```powershell
docker stop lydoc-remediation-postgres-20260810
Remove-Item -LiteralPath 'C:\Users\pjutg\AppData\Local\Temp\lydoc-trivy-20260810' -Recurse -Force
Remove-Item -LiteralPath 'C:\Users\pjutg\AppData\Local\Temp\lydoc-dynamic-20260810' -Recurse -Force
```

## Bloqueurs avant publication

### P0 — ouverture interdite tant que non clos

- **Mentions légales incomplètes** : nom, prénom, domicile, téléphone et directeur de publication sont encore explicitement marqués « à compléter ».
- **Hébergement réel non confirmé** : service/région OVHcloud, coordonnées contractuelles, DNS, certificats TLS et configuration Nginx réelle.
- **Conformité fournisseurs** : DPA, localisation/transferts et base légale pour OVHcloud, Mistral, Resend et tout prestataire futur.
- **Catalogue initial absent/non prouvé** : créer la source, approuver au moins un règlement réellement utilisable et obtenir `/health/ready=200`.
- **Corpus métier non validé** : tester un échantillon anonymisé représentatif de chaque facture Orange supportée et documenter faux positifs/faux négatifs.
- **Pipeline final non exécuté sur le commit de release** : CI entière, images reconstruites et scan container sans High/Critical.
- **Exercice restauration non réalisé sur l’hébergement cible** et copie chiffrée hors hôte non prouvée.
- **Supervision/alertes non raccordées** : readiness, espace disque, quotas, jobs de purge, outbox e-mail/dead letters et états postaux ambigus.
- **Revue juridique** des CGU, confidentialité, mentions légales et durées/bases de rétention.

### P1 — à traiter avant ou immédiatement pendant la bêta fermée

- Organiser deux administrateurs MFA et une procédure de récupération hors bande ; aucun recovery code n’est fourni.
- Tester la rotation des secrets document/outbox/MFA et l’alerte dead-letter.
- Formaliser les demandes d’effacement chez Stripe, Resend, Mistral et le prestataire postal ; elles restent procédurales.
- Faire exécuter un pentest indépendant sur la préproduction, particulièrement uploads, IDOR, auth/MFA et courses transactionnelles.
- Prévoir un nettoyage contrôlé des blobs orphelins détectés par l’inventaire. Un kill dans la fenêtre très courte entre `writeFile` et l’enregistrement de la référence peut encore laisser un objet sans ligne DB.
- Conserver une seule instance API tant qu’un stockage partagé et un rate limiter distribué ne sont pas en place.

## Checklist de décision GO

La bêta publique gratuite peut passer à GO uniquement si toutes les cases suivantes sont cochées :

- [ ] Identité éditeur, directeur de publication et hébergeur complétés et validés.
- [ ] CGU/confidentialité/mentions légales et rétentions relues par un professionnel compétent.
- [ ] DNS, TLS, Nginx et `TRUST_PROXY_CIDRS` exact déployés.
- [ ] Secrets uniques stockés dans un gestionnaire de secrets ; préflight vert.
- [ ] Migrations 0→13, statut et diff verts sur la base cible.
- [ ] Backfill `GeneratedPacket` sans reste si la base est héritée.
- [ ] Administrateurs MFA provisionnés et procédure de secours testée.
- [ ] Premier règlement approuvé et catalogue métier testé ; readiness 200.
- [ ] Corpus Orange anonymisé validé, y compris scans, logos et cas adversariaux.
- [ ] CI complète verte ; images finales sans High/Critical.
- [ ] E2E navigateur, IDOR deux comptes et ZAP préproduction verts.
- [ ] Resend/Mistral sandbox validés avec vérification des données transmises.
- [ ] Sauvegarde chiffrée hors hôte et restauration complète réussie.
- [ ] Alertes espace disque, DLQ, purge, quotas et readiness reçues par l’astreinte.
- [ ] Proxy public ouvert seulement après tous les contrôles précédents.

## Commandes de validation de release

```powershell
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm audit --prod --audit-level moderate
pnpm audit --audit-level moderate

powershell -ExecutionPolicy Bypass -File scripts/test-preflight-production.ps1
powershell -ExecutionPolicy Bypass -File scripts/preflight-production.ps1 `
  -EnvironmentFile .env.production

docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d
docker compose --env-file .env.production -f docker-compose.production.yml ps -a
```

Pour une base héritée :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml `
  run --rm --build generated-packet-backfill

docker compose --env-file .env.production -f docker-compose.production.yml `
  run --rm --build generated-packet-backfill --apply
```

Pour l’administrateur initial :

```powershell
docker compose --env-file .env.production -f docker-compose.production.yml `
  run --rm --build admin-provision --email admin@example.org
```

Les procédures détaillées sont dans `docs/deployment.md` et `docs/operations.md`.
