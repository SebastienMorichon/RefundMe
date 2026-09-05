# Audit de préparation à la bêta publique et de sécurité

**Projet :** Lydoc / Docflow  
**Date :** 2 août 2026  
**État audité :** branche `agent/payment-and-dossier-pdf`, worktree local courant incluant les fichiers modifiés et non suivis  
**Verdict :** **NO-GO pour une bêta publique**

## 1. Résumé exécutif

Le parcours gratuit principal est réellement implémenté : inscription, dépôt chiffré, analyse, constitution du dossier et génération du PDF sont branchés. Le monorepo compile, les 47 tests existants passent localement et sous Linux/Node 22, et les contrôles de propriété testés empêchent l’accès croisé aux documents.

La publication publique reste néanmoins dangereuse. Le risque le plus grave permet à un tiers de préempter un compte administrateur en inscrivant une adresse présente dans `ADMIN_EMAILS`, sans vérification de possession de cette adresse. Des blocages supplémentaires concernent le contournement du rate limiting, des sessions administrateur non révocables, 14 avis de sécurité dans les dépendances de production, l’absence de quotas sur les traitements OCR, une politique de rétention non exécutée, des sauvegardes de production incorrectes, une configuration gratuite qui échoue à la readiness, et des pages juridiques qui affichent encore qu’elles doivent être complétées avant ouverture.

### Décision synthétique

| Domaine | État | Décision |
| --- | --- | --- |
| Parcours gratuit principal | Implémenté, buildable | Base exploitable |
| Sécurité applicative | 1 critique, 10 élevés, plusieurs moyens | Bloquant |
| Dépendances de production | 7 avis élevés, 7 modérés | Bloquant |
| CI et reproductibilité | Tests verts localement, workflow CI incomplet et actuellement cassé | Bloquant |
| Déploiement gratuit | Readiness incompatible avec les services désactivés | Bloquant |
| Sauvegarde/restauration | Sauvegarde documentaire visant le mauvais chemin, restauration non testée | Bloquant |
| RGPD et juridique | Textes incomplets, consentement non prouvable, rétention non automatisée | Bloquant |
| Tests Web/E2E/accessibilité | Absents | Bloquant avant ouverture large |
| Exploitation/observabilité | Socle minimal, alertes et reprise incomplètes | Insuffisant |

La trajectoire recommandée est une **bêta fermée, plafonnée et sur invitation** uniquement après correction des P0. Une bêta gratuite ouverte au public ne doit pas être lancée avant la fermeture de tous les constats critiques et élevés, une restauration complète réussie, l’automatisation de la rétention et la validation juridique.

## 2. Périmètre et méthode

### Périmètre examiné

- monorepo pnpm : Next.js, NestJS, packages domaine/application/infrastructure/config/UI ;
- schéma Prisma et migrations PostgreSQL ;
- authentification, autorisation, sessions, routes administrateur et contrôles d’appartenance ;
- uploads, chiffrement, filigranage, OCR/IA, génération PDF et cycle de vie documentaire ;
- paiements Stripe, envoi postal, webhooks et notifications ;
- Dockerfiles, Compose développement/production, scripts de démarrage, sauvegarde et vérification ;
- CI GitHub Actions, dépendances, licences, secrets et historique Git ;
- pages publiques, parcours gratuit, UX, accessibilité, mentions légales, CGU, confidentialité et cookies ;
- tests statiques, dynamiques HTTP et OWASP ZAP sur des builds locaux de production.

### État du dépôt

L’audit a volontairement porté sur le worktree local complet, car il contient une quantité importante de changements non commités et de fichiers non suivis. Ces éléments appartiennent au projet et ont été préservés. Le résultat n’est donc pas encore reproductible depuis le seul commit Git courant : `Dockerfile`, `.dockerignore`, le Compose de production, les migrations et plusieurs modules/tests nécessaires ne sont notamment pas suivis.

Le seul fichier source ajouté par l’audit est le présent rapport. Les builds et rapports bruts sont placés dans des répertoires ignorés.

### Limites assumées

- aucun appel réel à Mistral, Stripe live, Resend ou au prestataire postal ;
- aucun test sur un hébergement Internet réel, donc pas de validation DNS, TLS, pare-feu, WAF ou configuration du proxy final ;
- pas de malware réel, bombe de décompression extrême ou charge destructrice ;
- pas de restauration de production, faute d’un environnement de sauvegarde cible préparé ;
- le scan actif ZAP API a été non authentifié. Les cas authentifiés ont été testés avec des sondes ciblées à deux utilisateurs et un administrateur ;
- cet audit ne remplace pas un test d’intrusion indépendant avant ouverture large.

## 3. Ce qui fonctionne déjà

- Le parcours inscription, upload, analyse et création de dossier est branché : `apps/web/app/inscription/page.tsx:109-170`.
- Le mode gratuit `SELF_SERVICE` est autorisé tandis que l’offre postale reste protégée par feature flag : `apps/api/src/modules/eligibility/eligibility.service.ts:712-776`.
- Le dossier PDF est généré puis servi au client : `apps/api/src/modules/packets/packets.controller.ts:12-28`.
- Les opérations client inspectées filtrent par `ownerId`. Le test dynamique à deux comptes a confirmé qu’un second utilisateur ne voit pas le document du premier et reçoit `404` en tentant de le supprimer.
- Toutes les routes `admin/*` inspectées utilisent `AuthGuard` puis `AdminGuard`.
- Prisma est utilisé sans SQL dynamique provenant d’une requête utilisateur.
- Aucun sink applicatif dynamique SSRF, `eval`, `dangerouslySetInnerHTML` ou exécution de commande issue du trafic HTTP n’a été trouvé.
- Les documents sont chiffrés en AES-256-GCM avec IV aléatoire et AAD propriétaire/type ; les secrets insuffisants sont refusés en production.
- Le cookie est `HttpOnly`, `Secure` en production, host-only et `SameSite=Lax`.
- CORS utilise une allowlist. Le test dynamique confirme que l’origine autorisée reçoit l’en-tête attendu et que l’origine interdite ne le reçoit pas.
- Stripe vérifie la signature du webhook, la session, le dossier, le montant et la devise.
- Les logs HTTP n’enregistrent ni query string, ni corps, ni contenu documentaire.
- `.env.local` est ignoré par Git. Les scans du worktree et de l’historique n’ont trouvé aucun secret réel suivi.
- TRACE est refusé, les source maps de production ne sont pas servies et la tentative SSRF via `next/image` testée a été rejetée.

Ces points sont de bons fondements, mais ils ne compensent pas les risques bloquants détaillés ci-dessous.

## 4. Vérifications exécutées et résultats

### Qualité, build et base de données

| Vérification | Résultat |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | PASS, 8 projets, lockfile inchangé |
| build des cinq packages partagés | PASS 5/5 |
| `pnpm -r --stream typecheck` | PASS 7/7 |
| `pnpm lint` | PASS 7/7 |
| lint manuel étendu à `apps/web/components` et `apps/web/lib` | PASS |
| `pnpm test` | PASS, 47/47, aucun skip/todo |
| suite API répétée cinq fois | PASS, 130/130, aucun flake observé |
| `pnpm build` | PASS 7/7, 23 routes Next générées |
| validation Prisma avec URL factice | PASS |
| déploiement des deux migrations sur PostgreSQL isolé | PASS |
| `prettier --check .` | FAIL, 82 fichiers non conformes |
| `eslint .` global | FAIL, 164 erreurs de configuration/contexte CJS/scripts |

Répartition des 47 tests : config 3, application 15, infrastructure 3 et API 26. Il n’existe aucun vrai test Web/UI/domaine, navigateur, HTTP/Supertest, PostgreSQL, migration ou accessibilité.

La couverture Node ne mesure que les fichiers chargés. Elle donne :

- config : 62,50 % lignes ;
- application : 90,58 % ;
- infrastructure : 98,10 % ;
- API chargée : 51,59 % ;
- `shipping.service` : 10,26 % ;
- paiements : 21,21 % ;
- pricing : 40,44 % ;
- packets : 58,88 % ;
- notifications : 69,77 %.

Comme les fichiers non chargés n’apparaissent pas, la couverture API réelle est inférieure à 51,59 %.

### CI et Docker

| Vérification | Résultat |
| --- | --- |
| Compose développement et production, syntaxe | PASS une fois les variables injectées |
| `docker build --check` | PASS |
| build des targets Docker API et Web | PASS sous Linux/Node 22 |
| 47 tests dans le builder Linux | PASS |
| écriture `.next/cache` avec l’utilisateur runtime `node` | FAIL, permission refusée |
| workflow GitHub `pnpm prisma:validate` sans variable | FAIL P1012, `DATABASE_URL` absente |

Le build Linux émet aussi `Fontconfig error: Cannot load default config file` pendant le filigranage image. Le test actuel vérifie format et dimensions, pas visuellement la présence correcte du texte.

### Dépendances, licences et secrets

- `pnpm audit --prod --json` : **14 avis de production, 7 élevés et 7 modérés, 0 critique**.
- audit complet : **18 avis, 11 élevés et 7 modérés**.
- scan de licences production : 160 entrées, aucune licence inconnue.
- `@img/sharp-win32-x64` embarque `Apache-2.0 AND LGPL-3.0-or-later` : notices et obligations de redistribution à documenter.
- recherche de préfixes de secrets et de clés privées dans le worktree : aucun secret réel détecté.
- recherche dans l’historique Git : aucun ancien `.env` suivi ni préfixe secret réel détecté.

### Tests HTTP authentifiés ciblés

Une API de production locale a été lancée sur une base PostgreSQL isolée, avec des secrets de test et les fournisseurs payants désactivés. Les tests ont confirmé :

- `GET /health/live` : `200` ; `GET /health/ready` : `503` malgré la configuration gratuite ;
- cookie : `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800; Secure` ;
- cookie altéré : `401` ;
- routes protégées sans cookie : `401` ;
- contrôle IDOR document entre deux comptes : liste isolée et suppression croisée `404` ;
- inscription de l’adresse `ADMIN_EMAILS` : `201` et rôle `ADMIN`, sans vérification d’e-mail ;
- après rétrogradation du compte en `USER` dans PostgreSQL, l’ancien cookie a encore obtenu `200` sur `/admin/pricing` ;
- limitation `/auth/login` atteinte, puis `/auth/login/` a contourné le `429` et atteint la route ;
- 25 appels au webhook Stripe n’ont déclenché aucun `429` ni en-tête de limite ;
- un mot de passe de 100 000 caractères a été accepté ;
- un faux PDF commençant par des octets arbitraires puis contenant `%PDF-` a été accepté comme document ;
- une inscription dupliquée révèle explicitement qu’un compte existe ;
- les réponses authentifiées JSON testées n’ont pas `Cache-Control: no-store` ;
- l’identifiant de requête malveillant a été remplacé, donc pas réfléchi ;
- la requête cross-origin de style formulaire a atteint le traitement serveur malgré l’absence d’en-tête CORS de réponse, montrant que CORS n’est pas une protection CSRF côté serveur.

### OWASP ZAP

**Web, scan passif de build production :** 69 URL, 58 règles sans alerte, 9 familles de warnings, 0 fail. Alertes principales : anti-clickjacking, CSP, `nosniff`, Permissions-Policy et isolation cross-origin absents, bannière `X-Powered-By`, et données du formulaire de contact plaçables dans la query string lorsque JavaScript n’intercepte pas la soumission.

**API, scan actif non authentifié depuis un OpenAPI d’audit :** 41 URL importées, 118 URL analysées, 120 règles sans alerte, 2 familles de warnings, 0 fail. ZAP n’a pas trouvé d’injection SQL, XSS, path traversal, XXE, SSTI ou exécution de commande sur la surface non authentifiée scannée. Les warnings portent sur la readiness à `503` et la bannière Express.

Rapports bruts locaux :

- `tmp/zap-web.html`, `tmp/zap-web.json`, `tmp/zap-web.md` ;
- `tmp/zap-api.html`, `tmp/zap-api.json`, `tmp/zap-api.md`.

L’absence d’alerte ZAP ne prouve pas l’absence de vulnérabilité métier ; les failles critiques de rôle, session, quotas et rétention sont précisément hors de la portée d’un scanner générique.

## 5. Constats de sécurité

### SEC-01 — Critique — Préemption du premier compte administrateur

**Preuves :** `apps/api/src/modules/identity/identity.controller.ts:48-55,135-142`, `packages/application/src/use-cases/identity/register-user.ts:11-28`, `docs/deployment.md:22-24`.

L’endpoint public attribue `ADMIN` à toute personne inscrivant une adresse présente dans `ADMIN_EMAILS`. La possession de l’adresse n’est jamais prouvée. Le test dynamique a reproduit l’élévation.

**Impact :** accès immédiat aux factures clientes, règles, tarifs et opérations de cycle de vie. La procédure documentée crée une fenêtre de course au premier déploiement.

**Correction exigée :** supprimer toute élévation de rôle de l’inscription publique. Provisionner l’administrateur hors bande par CLI/migration ponctuelle ou invitation signée et courte après vérification de l’e-mail. Exiger MFA/passkey pour les administrateurs et journaliser le provisionnement.

**Critère de retest :** une inscription publique utilisant une adresse administrative reçoit toujours `USER`; seule une procédure administrative authentifiée peut élever le rôle.

### SEC-02 — Élevé — Rate limiting contournable

**Preuves :** `apps/api/src/platform/http-protection.ts:9,67-114`, `deploy/production.env.example:7`, `docker-compose.production.yml:32-33`.

Les motifs du limiteur sont exacts et sensibles à la casse alors qu’Express ne l’est pas par défaut. `/auth/login/` et `/AUTH/LOGIN` atteignent la route sans partager le quota de `/auth/login`. La clé est seulement `IP:path`, en mémoire. Avec `TRUST_PROXY=true`, une mauvaise configuration du proxy laisse `X-Forwarded-For` piloter `request.ip`. Le port API est exposé directement.

**Correction exigée :** limiter la route normalisée, fermer les variantes de casse/slash, ajouter limites par IP, compte, identifiant et globales, temporisation progressive et stockage partagé Redis/WAF. Configurer les hops/CIDR proxy, ne plus publier le port API directement.

### SEC-03 — Élevé — Parsing global de 30 Mo avant protections

**Preuves :** `apps/api/src/main.ts:16-19`, `packages/domain/src/identity/user.ts:13-20`, `packages/application/src/use-cases/identity/register-user.ts:14-16`, `apps/api/src/modules/documents/documents.controller.ts:27-35`.

La limite JSON de 30 Mo s’applique avant rate limiter et guards à toutes les routes. E-mail, mot de passe et nom de fichier n’ont pas de longueur maximale. Un mot de passe de 100 000 caractères a été accepté.

**Correction exigée :** limite globale courte au proxy et dans Nest, exceptions route par route, upload multipart/streaming, longueurs maximales strictes, délais de lecture et limites de connexions.

### SEC-04 — Élevé — Déni de service et épuisement des quotas OCR/IA

**Preuves :** `apps/api/src/modules/documents/documents.controller.ts:34-35`, `packages/infrastructure/src/documents/pdf-image-document-watermark-provider.ts:44-103`, `apps/api/src/modules/eligibility/eligibility.controller.ts:22-32`, `packages/infrastructure/src/ocr/mistral-ocr-provider.ts:11-22`.

Il n’existe aucun quota par compte, stockage, jour ou fournisseur, ni limite de pixels/pages/objets, queue, limite de concurrence, timeout ou circuit breaker Mistral. Des comptes gratuits non vérifiés peuvent déposer et faire analyser des documents coûteux.

**Correction exigée :** vérification d’e-mail, quota par compte/IP, plafond de stockage, limites pixels/pages, worker isolé avec CPU/RAM/timeout, queue et budget fournisseur avec alertes et coupure automatique.

### SEC-05 — Élevé — Dépendances de production vulnérables

| Composant | Version observée | Risque | Version corrective minimale indiquée |
| --- | --- | --- | --- |
| Next.js | 15.5.20 | DoS, SSRF, confusion de cache, divulgation de fonctions | 15.5.21 |
| Sharp/libvips | 0.34.5 | plusieurs CVE libvips, entrée image client directement exposée | 0.35.0 |
| Multer | 2.1.1 | DoS par champs imbriqués et nettoyage incomplet | 2.2.0 |
| PostCSS transitif | 8.4.31/8.5.x | lecture de fichiers/path traversal/XSS selon chemin | 8.5.18 pour couvrir les avis |

**Correction exigée :** mettre à jour et verrouiller les versions, reconstruire les images, relancer tests, audit et ZAP, puis faire échouer la CI sur tout avis élevé de production.

### SEC-06 — Élevé — Sessions non révocables et rôle obsolète

**Preuves :** `apps/api/src/modules/identity/session.service.ts:27-63`, `apps/api/src/modules/identity/auth.guard.ts:9-19`, `apps/api/src/modules/identity/admin.guard.ts:6-13`.

Le cookie signé contient le rôle et reste valide sept jours sans consultation de la base. La rétrogradation dynamique d’un administrateur n’a pas supprimé son accès. Il n’existe ni logout, ni révocation globale, ni changement/récupération de mot de passe.

**Correction exigée :** sessions opaques hashées en base, `revokedAt`, rotation, expiration, consultation du rôle courant pour les actions sensibles, logout local/global et cookie préfixé `__Host-`.

### SEC-07 — Élevé — Cycle de vie des données sensibles non exécuté

**Preuves :** `apps/api/src/modules/documents/admin-document-lifecycle.controller.ts:24-32`, `apps/api/src/modules/documents/document-lifecycle.service.ts:33-50,228-248`, `apps/web/app/confidentialite/page.tsx:145-166`.

La rétention est une opération administrateur manuelle, sans scheduler. Les documents rattachés à un dossier sont exclus et l’effacement est refusé pour les dossiers finalisés. La promesse publique de purge à 30 jours après le premier dossier final n’est donc pas tenue.

**Correction exigée :** job planifié supervisé, événement de premier téléchargement/finalisation, purge physique vérifiable, reprise des échecs, alertes, purge des révisions et journaux, tests automatisés et procédure RGPD.

### SEC-08 — Élevé — Données dérivées et sauvegardes insuffisamment chiffrées

**Preuves :** `prisma/schema.prisma:161-180`, `scripts/backup-lydoc.ps1:31-68`.

Le texte OCR intégral et les métadonnées personnelles sont stockés en clair dans PostgreSQL. Les dumps PostgreSQL sont locaux, non chiffrés et seulement accompagnés d’un hash non signé.

**Correction exigée :** minimiser et purger rapidement le texte OCR, chiffrer les champs sensibles ou séparer le stockage, chiffrer et rendre immuables les sauvegardes hors hôte, signer les manifestes et protéger la clé séparément.

### SEC-09 — Élevé — Suppression destructive possible d’un dossier payé/expédié

**Preuves :** `apps/api/src/modules/eligibility/eligibility.service.ts:632-660`.

Le propriétaire peut supprimer paiement, envoi, notifications et dossier sans contrôle d’état ni audit spécifique.

**Correction exigée :** suppression physique seulement pour les brouillons sans paiement ; soft-delete/cancel ailleurs ; ledger financier/postal conservé selon les obligations ; audit de la demande et expiration des checkouts ouverts.

### SEC-10 — Élevé — Fichiers client insuffisamment neutralisés

**Preuves :** `packages/application/src/use-cases/documents/upload-user-document.ts:9-18,38-52`, `apps/api/src/modules/documents/admin-invoices.controller.ts:71-127`.

Le contrôle se limite au MIME déclaré et à quelques octets magiques. Le test a fait accepter un faux PDF polyglotte. Les factures sont ensuite ouvertes `inline` par un administrateur, sans antivirus/CDR ni neutralisation du contenu actif.

**Correction exigée :** antivirus et CDR, parsing structurel strict, limites pages/objets, rasterisation ou assainissement, worker sans privilège, origine dédiée sandboxée et téléchargement `attachment` par défaut.

### SEC-11 — Élevé — Exposition directe des ports et secrets trop largement injectés

**Preuves :** `docker-compose.production.yml:24,32-33,54,61-62`, `docs/deployment.md:7`.

Les ports Web/API sont exposés alors que le durcissement repose sur un proxy TLS externe. Le même `env_file`, contenant tous les secrets API, est également injecté dans le conteneur Web.

**Correction exigée :** réseau Docker privé et proxy unique, bind local ou `expose`, pare-feu hôte, TLS/timeouts/WAF, fichiers de variables séparés et principe du moindre secret.

### SEC-12 — Moyen — Protection CSRF incomplète et GET avec effet de bord

**Preuves :** `apps/api/src/main.ts:20-23`, `apps/api/src/modules/identity/identity.controller.ts:110-117`, `apps/api/src/modules/packets/packets.service.ts:204-208`.

`SameSite=Lax` et CORS réduisent le risque mais ne remplacent pas une défense CSRF, notamment pour les sous-domaines same-site. Le téléchargement PDF en GET modifie le statut en `GENERATED`.

**Correction :** valider Origin/Referer, jeton CSRF sur les méthodes mutatives, aucune mutation en GET.

### SEC-13 — Moyen — Webhook postal rejouable avec secret en URL

**Preuves :** `apps/api/src/modules/shipping/shipping.controller.ts:52-62`, `apps/api/src/modules/shipping/shipping.service.ts:449-479`, `docs/operations.md:45-49`.

Le secret est un token de query statique, sans signature du raw body, timestamp ni identifiant d’événement. Les transitions ne sont pas garanties monotones.

**Correction :** HMAC en header, timestamp et fenêtre anti-rejeu, identifiant unique, transitions autorisées, rotation, aucun secret dans l’URL.

### SEC-14 — Moyen — Checkout Stripe non idempotent

**Preuves :** `apps/api/src/modules/payments/payments.service.ts:112-169,287-304`.

Deux appels concurrents peuvent créer deux checkouts avant l’upsert ; seul le dernier ID reste en base et le paiement de l’ancien peut être ignoré.

**Correction :** clé d’idempotence Stripe stable, verrou/version du devis, expiration des anciennes sessions, ledger d’événements unique et réconciliation périodique.

### SEC-15 — Moyen — La politique « documents sensibles jamais envoyés à l’IA » dépend d’un type client

**Preuves :** `apps/api/src/modules/documents/documents.controller.ts:27-32,83-89`, `apps/api/src/platform/ai-document-policy.ts:3-15`, `apps/web/app/confidentialite/page.tsx:70-78`.

Un utilisateur peut étiqueter une pièce d’identité comme facture et provoquer son envoi à Mistral.

**Correction :** classification/DLP locale, consentement explicite par document, invariant serveur et journal de transmission fournisseur.

### SEC-16 — Moyen — Identité et consentement incomplets

**Preuves :** `apps/web/app/inscription/page.tsx:109-114,452-477`, `prisma/schema.prisma:90-104`, `packages/application/src/use-cases/identity/authenticate-user.ts:12-15`.

Pas de vérification d’e-mail, récupération, MFA admin, version/date de consentement ou réponse d’inscription générique. Le login inexistant évite scrypt et crée aussi un canal temporel.

**Correction :** vérification e-mail, réponse générique, faux hash pour compte absent, consentement versionné/horodaté, récupération sécurisée et MFA administrateur.

### SEC-17 — Moyen — En-têtes Web, cache et formulaire de contact

**Preuves :** `apps/web/next.config.ts:3-5`, `apps/web/components/contact-form.tsx:9-18`.

Le front ne renvoie ni CSP, ni anti-framing, ni HSTS, `nosniff`, Referrer-Policy ou Permissions-Policy et divulgue `X-Powered-By: Next.js`. Les réponses JSON authentifiées manquent de `private, no-store`. Sans exécution JavaScript, le formulaire de contact se soumet en GET et place nom, e-mail, sujet et message dans l’URL.

**Correction :** politique d’en-têtes commune proxy/Next, CSP avec `frame-ancestors 'none'`, suppression des bannières, `no-store` sur PII et soumission contact côté serveur en POST avec protection anti-spam.

### SEC-18 — Moyen — Readiness coûteuse et publiquement abusée

**Preuves :** `apps/api/src/modules/health/health.controller.ts:11-63`.

`/health` et `/health/ready` interrogent la base et créent/suppriment un fichier à chaque appel, sans limite.

**Correction :** liveness légère, readiness mise en cache et réservée au réseau de supervision.

### SEC-19 — Moyen — Messages internes parfois renvoyés

**Preuves :** `apps/api/src/modules/identity/identity.controller.ts:120-130`, `apps/api/src/modules/documents/documents.controller.ts:147-157`.

Des messages d’erreur Prisma/fichier peuvent être renvoyés tels quels.

**Correction :** allowlist de codes/messages métier, message public générique, détail uniquement dans les logs corrélés.

### SEC-20 — Moyen — Image et supply chain CI peu durcies

**Preuves :** `Dockerfile:25-36`, `.github/workflows/ci.yml:13-26`.

Les runtimes héritent du builder complet avec sources, dépendances de développement et CLI. Les actions GitHub utilisent des tags mutables ; aucun SAST, scan secret, SBOM ou scan conteneur n’est imposé.

**Correction :** images standalone/minimales, dépendances production uniquement, filesystem read-only, capabilities/ressources limitées, actions pinées par SHA, CodeQL/Semgrep, Gitleaks, audit, SBOM et scan image.

### SEC-21 — Moyen — Clé de chiffrement sans rotation

**Preuves :** `packages/infrastructure/src/storage/local-encrypted-object-storage-provider.ts:55-101`, `docs/operations.md:73`.

Le format `LYDOC1` ne porte aucun key ID et une seule clé courante est acceptée. Une rotation rend les anciens objets illisibles.

**Correction :** enveloppe versionnée avec key ID, KMS, double lecture pendant migration et exercice de rotation/restauration.

### Défense en profondeur

- Confiner les chemins de stockage avec `resolve()` et un contrôle de préfixe : `packages/infrastructure/src/storage/local-encrypted-object-storage-provider.ts:40-52`.
- Versionner et calibrer explicitement les paramètres scrypt, avec longueur maximale et migration progressive : `apps/api/src/modules/identity/node-password-hasher.service.ts:10-30`.
- Ajouter `/.well-known/security.txt`, `robots.txt` et `sitemap.xml` ; les trois sont absents sur le build testé.

## 6. Constats produit, exploitation et conformité

### REL-01 — P0 — Une configuration gratuite reste `not ready`

**Preuves :** `apps/api/src/modules/health/health.controller.ts:66-99`, `deploy/production.env.example:14-24`, `docker-compose.production.yml:37-60`.

La readiness exige sans condition Mistral, Stripe live, webhook Stripe et Resend. L’exemple laisse plusieurs valeurs vides et configure le prestataire postal. Le Web attend l’API saine avant de démarrer. Le test local en configuration gratuite retourne `503`.

**À faire :** rendre les exigences conditionnelles aux fonctionnalités actives, créer un profil `free-beta` explicite avec offre postale coupée et `POSTAL_PROVIDER=mock`, puis réussir un démarrage à froid complet.

### REL-02 — P0 — Mentions légales et RGPD explicitement inachevés

**Preuves :** `docs/legal-roadmap.md:21-33`, `apps/web/app/mentions-legales/page.tsx:27-43,105`, `apps/web/app/confidentialite/page.tsx:14-23,124-127`.

Identité de l’éditeur, directeur de publication, hébergeur réel, registre des traitements, DPA/localisations/transferts, durées, procédure de droits et violation restent à compléter. Les pages publiques l’affichent.

**À faire :** validation juridique, données éditeur/hébergeur, registre, contrats sous-traitants, procédure droits/violation, adresse RGPD testée et cohérence exacte entre politique et code.

### REL-03 — P0 — Sauvegarde de production invalide et restauration absente

**Preuves :** `docker-compose.production.yml:28-31`, `scripts/backup-lydoc.ps1:31-68`, `scripts/verify-backup.ps1:13-23`.

Le volume Docker est monté dans le conteneur, mais le script hôte archive un autre chemin. Il peut produire un manifeste positif sans archive documentaire. Le dump et les fichiers ne forment pas un snapshot cohérent. Le vérificateur contrôle des SHA, pas la restauration.

**À faire :** sauvegarder le volume réel, garantir cohérence DB/objets, chiffrer/exporter hors hôte, sauvegarder la clé séparément, fournir un script de restauration et réussir un exercice complet avec ouverture d’un échantillon de documents.

### REL-04 — P0 — Consentement et rétention annoncée non prouvables

La checkbox CGU/confidentialité est purement UI et le schéma n’enregistre ni version ni date. Les uploads reçoivent 365 jours ; le premier téléchargement n’est pas enregistré et `GeneratedPacket` n’est pas créé.

**Preuves :** `apps/web/app/inscription/page.tsx:452-476`, `prisma/schema.prisma:90-104`, `apps/api/src/modules/documents/prisma-document.repository.ts:32-35`, `apps/api/src/modules/packets/packets.service.ts:171-211`.

**À faire :** stocker version/date/finalité du consentement et implémenter le déclencheur réel de rétention annoncé.

### REL-05 — P0 — Catalogue métier absent sur une base neuve

Seuls les règlements `APPROVED` apparaissent et aucun seed production n’existe : `apps/api/src/modules/rules/rules.service.ts:152-160`, `apps/web/app/inscription/page.tsx:57-70`.

**À faire :** charger les règlements réels, double validation humaine, tests de factures représentatives, propriétaire de mise à jour/archivage et revue régulière.

### REL-06 — P0 — Candidat de release non reproductible

Les fichiers Docker, migrations et modules/tests critiques sont non suivis ; CI, manifests et lockfile sont modifiés. Une publication depuis HEAD ne correspond pas à l’état testé.

**À faire :** commit propre et revu, branche de release depuis un checkout vierge, lockfile gelé, tag/version/image immuable et preuve que la CI reconstruit exactement l’artefact publié.

### REL-07 — P0 — CI rouge et runtime Web Docker non inscriptible

- Le workflow n’injecte pas `DATABASE_URL` avant `pnpm prisma:validate`, donc échoue P1012 : `.github/workflows/ci.yml:21-26`, `prisma/schema.prisma:7`.
- `.next/cache` appartient à root alors que le runtime passe à `USER node`. `next/image` est utilisé et l’écriture de cache échoue : `Dockerfile:32-36`, `apps/web/components/auth-shell.tsx:1`, `apps/web/app/page.tsx:1`.

**À faire :** URL factice de validation CI, test migration PostgreSQL réel, ownership correct ou standalone Next minimal, smoke test image en utilisateur non-root.

### REL-08 — P1 — Couverture et tests insuffisants

Aucun test Web/UI/domaine, HTTP, DB, migration, E2E, accessibilité ou responsive. Les services paiement et shipping, pourtant sensibles, sont très peu couverts.

**À faire :** tests HTTP avec vraie base, matrice AuthN/AuthZ/IDOR, migrations up/down compatibles, E2E Playwright multi-navigateurs, axe, tests paiements/webhooks/idempotence, rétention, sauvegarde/restauration et seuils de couverture. Cible recommandée : au moins 80 % globale, 100 % des branches critiques auth/upload/paiement/rétention.

### REL-09 — P1 — Résilience fournisseurs insuffisante

Les appels Mistral sont synchrones, sans timeout/retry ; les erreurs ne disposent pas d’une queue/DLQ. Resend garde l’échec sans worker de reprise : `packages/infrastructure/src/ocr/mistral-ocr-provider.ts:11-22`, `packages/infrastructure/src/ai/mistral-ai-provider.ts:19-41`, `apps/api/src/modules/notifications/notifications.service.ts:127-135`.

**À faire :** timeout, retries bornés, idempotence, queue, dead-letter, reprise manuelle et tests de panne après succès fournisseur.

### REL-10 — P1 — Observabilité et support incomplets

Il existe des healthchecks et des logs HTTP JSON, mais pas de métriques métier/coût, trace, error tracking, alerte OCR, tableau de rétention ou reprise. Les documents demandent encore de les configurer : `docs/deployment.md:35-36`, `docs/operations.md:77-82`.

**À faire :** agrégation de logs, alertes 5xx/readiness/fournisseurs, budgets, dashboard, canal d’incident, SLA bêta, procédure RGPD et statut public.

### REL-11 — P1 — Fonctionnalités de compte incomplètes

- « Changer de compte » n’invalide aucune session : `apps/web/components/app-shell.tsx:154-159,228-230`.
- « Mot de passe oublié » renvoie au contact : `apps/web/app/connexion/page.tsx:52`.
- Aucun logout, reset, vérification e-mail, suppression de compte ou export/portabilité.
- Le formulaire de contact ouvre seulement un `mailto:` : `apps/web/components/contact-form.tsx:9-19`.
- Le client affiche 8 caractères minimum tandis que le serveur en exige 10 : `apps/web/app/inscription/page.tsx:99-101`, `packages/application/src/use-cases/identity/register-user.ts:14-16`.

### REL-12 — P1 — Accessibilité non validée

Le tiroir mobile n’a pas la gestion complète du focus/Escape/sémantique de dialogue et les filtres `role=tab` n’ont pas navigation clavier/tabpanel : `apps/web/components/app-shell.tsx:165-233`, `apps/web/app/cases/page.tsx:132-176`.

**À faire :** audit axe, clavier seul, lecteur d’écran, zoom 200/400 %, mobile et contraste sur le build déployé.

### REL-13 — P1 — Déploiement et rollback fragiles

Les images sont rebâties depuis le worktree, les migrations s’exécutent au démarrage de chaque API et la migration récente supprime colonnes/type : `Dockerfile:14-30`, `prisma/migrations/20260801170000_remove_sensitive_document_ai_validation/migration.sql:3-10`.

**À faire :** staging, images immuables, job migration unique, stratégie expand/contract, sauvegarde pré-migration, rollback applicatif testé, healthcheck Web, limites de ressources et déploiement progressif.

### REL-14 — P2 — Performance et documentation

- Ajouter des index adaptés aux requêtes documents propriétaire/date, dossiers propriétaire/date, rétention/purge et audit date : `apps/api/src/modules/documents/prisma-document.repository.ts:42-45`, `apps/api/src/modules/eligibility/eligibility.service.ts:342-346`, `apps/api/src/modules/documents/document-lifecycle.service.ts:228-248`.
- Corriger la dérive `game-rule-candidate-v1` documenté contre `v4` codé : `docs/operations.md:37`, `apps/api/src/modules/rules/rules.service.ts:69,116`.
- L’architecture annonce OpenAPI sans Swagger/spec livrée : `docs/architecture-lydoc.md:18,33`.
- Ajouter un README racine et un runbook d’onboarding.
- Fournir une font déterministe au filigranage Linux et tester visuellement le résultat.
- Formaliser les notices de licences tierces.

## 7. Plan de remédiation priorisé

### P0 — Obligatoire avant toute exposition publique

- [ ] Supprimer l’élévation admin depuis l’inscription publique ; provisionnement sûr + MFA.
- [ ] Rendre les sessions révocables et ajouter logout/global logout.
- [ ] Corriger le contournement du rate limiter, fermer l’accès direct API et ajouter quotas/budgets.
- [ ] Mettre à jour Next, Sharp, Multer et PostCSS jusqu’à zéro avis élevé/modéré de production accepté.
- [ ] Limiter corps/champs/pages/pixels et isoler les traitements fichiers/IA.
- [ ] Ajouter antivirus/CDR et neutraliser les PDF administrateur.
- [ ] Empêcher la suppression destructive des dossiers payés/expédiés.
- [ ] Corriger la readiness pour le profil gratuit et réussir un démarrage à froid.
- [ ] Corriger l’ownership `.next/cache` et valider l’image en non-root.
- [ ] Rendre la CI verte depuis un checkout vierge et suivre tous les fichiers de release.
- [ ] Finaliser mentions légales, RGPD, sous-traitants, consentement et procédures.
- [ ] Automatiser rétention/purge et prouver l’effacement physique.
- [ ] Corriger la sauvegarde du volume réel et réussir une restauration DB+documents+clé.
- [ ] Charger et valider le catalogue métier de production.
- [ ] Séparer les secrets Web/API et déployer derrière un proxy TLS réellement configuré.

### P1 — Avant bêta fermée significative

- [ ] Tests HTTP/DB/migrations/authz et E2E navigateur.
- [ ] Tests de concurrence/rejeu/idempotence Stripe et postal.
- [ ] Timeouts, queues, retry/DLQ et reprise fournisseurs.
- [ ] CSP/en-têtes Web, cache `no-store`, CSRF et sécurité du contact.
- [ ] Monitoring, budgets, alertes, error tracking, support et runbooks d’incident.
- [ ] Vérification d’e-mail, reset de mot de passe, export et suppression de compte.
- [ ] Audit accessibilité complet et correction du parcours d’inscription en cas d’échec partiel.
- [ ] Tests de charge ciblés upload, OCR, PDF, scrypt et readiness.
- [ ] Staging, rollback, migration unique et images minimales.

### P2 — Avant montée en charge

- [ ] Stockage objet chiffré/versionné au lieu du volume mono-instance.
- [ ] Rotation KMS avec key IDs et double lecture.
- [ ] Index DB et tests de performance.
- [ ] SBOM, scan conteneur, signature/provenance d’image et actions GitHub pinées par SHA.
- [ ] Documentation, licences, security.txt et statut public.

## 8. Critères de GO pour la bêta publique gratuite

La décision peut passer à GO uniquement si toutes les conditions suivantes sont prouvées :

1. **Sécurité :** zéro critique/élevé ouvert ; zéro avis élevé/modéré de dépendance non formellement accepté ; retest admin, session, rate limit, IDOR, CSRF, upload et quotas réussi.
2. **Release :** checkout Git propre, CI verte, artefact immuable signé, build Docker et smoke tests reproductibles.
3. **Production gratuite :** démarrage à froid sur base vierge, migrations réussies, `/health/ready` vert sans services payants désactivés.
4. **Données :** consentement versionné, rétention automatique, demande d’effacement testée et preuves de purge.
5. **Sauvegarde :** restauration complète réussie sur environnement isolé, y compris déchiffrement des documents.
6. **Juridique :** mentions légales et politique de confidentialité finalisées, sous-traitants/transferts validés, procédures droits et violation opérationnelles.
7. **Produit :** catalogue approuvé, parcours gratuit E2E réussi sur navigateurs principaux, erreurs/support compréhensibles.
8. **Exploitation :** TLS/proxy/pare-feu validés, monitoring et alertes actifs, budgets/quotas en place, rollback documenté et testé.
9. **Qualité :** couverture des flux critiques, aucun flake, audit accessibilité et charge ciblée réussis.
10. **Assurance :** pentest indépendant ciblé avant ouverture large, puis retest des correctifs.

## 9. Améliorations recommandées par ordre de valeur

1. Sécuriser l’identité et le rôle administrateur : c’est le risque de compromission totale le plus immédiat.
2. Fermer les abus gratuits : rate limiting normalisé, vérification e-mail, quotas et budget OCR protègent à la fois sécurité et viabilité économique.
3. Aligner les promesses RGPD avec le code : consentement, rétention, suppression, sauvegarde et restauration.
4. Transformer le déploiement en produit reproductible : CI verte, artefacts immuables, profil gratuit, secrets minimaux et rollback.
5. Construire les tests autour des frontières réelles : HTTP+DB, deux utilisateurs, admin, paiements, fichiers et E2E Web.
6. Réduire la surface : images minimales, proxy unique, CSP, antivirus/CDR, workers isolés et KMS.
7. Ajouter l’exploitation avant l’audience : métriques, alertes, support, budgets et procédures d’incident.

## 10. Artefacts et nettoyage

Artefacts conservés localement pour investigation : rapports ZAP, scripts de sondes dans `tmp/`, builds ignorés, caches Docker et image locale de validation `lydoc-audit-builder:20260802`.

La base PostgreSQL isolée `lydoc_audit`, les comptes/cookies de test et le faux document chiffré générés pendant l’audit ont été supprimés à la fin. Ils ne sont pas conservés ni récupérables, mais les tests sont reproductibles à partir des sondes et du présent rapport.

## 11. Conclusion

Lydoc dispose d’un cœur produit crédible et d’un socle de sécurité partiel, mais il n’est pas prêt à recevoir des utilisateurs inconnus sur Internet. Le risque critique de préemption administrateur suffit à lui seul à interdire la publication. Les dépendances vulnérables, les abus OCR, les sessions non révocables, la sauvegarde incorrecte, la rétention manuelle et le juridique inachevé renforcent ce NO-GO.

La meilleure prochaine étape est de fermer le lot P0, puis d’ouvrir une bêta fermée sur invitation avec un petit plafond d’utilisateurs, l’offre postale désactivée et un budget fournisseur strict. La bêta publique gratuite pourra suivre après preuve de restauration, purge, monitoring, tests E2E/charge et pentest indépendant.
