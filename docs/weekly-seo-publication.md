# Publication hebdomadaire des guides Lydoc

## Objectif et autorisation

Publier un nouvel article utile en français chaque mercredi à 9 h, heure de Paris,
sur https://lydoc.fr/guides, sans validation éditoriale humaine. L’utilisateur a
confirmé le 16 septembre 2026 que Coolify déploie automatiquement les mises à jour
de la branche main de SebastienMorichon/RefundMe.

Cette tâche est distincte du pack de contenus pour les réseaux sociaux et de
la veille des règlements. Elle ne modifie pas les règles utilisées pour les
dossiers clients et n’approuve aucune fiche réglementaire.

## Sélection et rédaction

1. Lire le catalogue à jour dans apps/web/lib/guides.ts et les articles publics.
   Choisir une question non couverte : interlocuteur, refus, justificatif manquant,
   frais d’envoi, lecture du règlement, situation particulière ou parcours opérateur.
   Vérifier les informations propres à un opérateur sur son assistance officielle.
2. Rechercher puis ouvrir les sources publiques primaires actuelles : règlement
   officiel, organisateur, opérateur, DGCCRF, Service-Public ou Surmafacture.fr.
   Ne pas déduire une procédure d’un extrait de recherche, d’un forum ou d’un concurrent.
3. Écrire un article original répondant directement à la question, avec étapes,
   exemples explicitement fictifs si utiles, et réponses aux incertitudes courantes.
   Adapter la longueur au sujet, sans remplissage ni répétition de mots-clés.
   Respecter les limites de citation et de paraphrase des sources.
4. Distinguer remboursement prévu au règlement, contestation de facturation et
   signalement de fraude. Ne jamais généraliser les conditions d’un jeu à tous
   les SMS. Ne pas inventer de délais, montants, résultats, témoignages ou droits.
   Lydoc prépare le dossier ; l’organisateur décide du remboursement.
5. Ajouter un objet Guide avec titre et description spécifiques, slug pérenne,
   date publishedAt et modifiedAt ISO réelle, updatedAt français correspondant,
   sources HTTPS effectivement consultées et 2 à 3 relatedSlugs pertinents.
   Le sitemap et les métadonnées utilisent automatiquement ces informations.
   Ajouter si pertinent un lien depuis un guide existant ; ne modifier sa date
   éditoriale qu’en cas de changement substantiel et vérifié de son contenu.

## Publication et reprise

- Travailler depuis la dernière version de origin/main dans un checkout isolé
  si le dossier courant contient d’autres changements. Ne pas publier ces autres
  changements, secrets, fichiers temporaires ou données client.
- Une seule nouvelle publication par semaine civile Europe/Paris (lundi à dimanche).
  Vérifier les dates du catalogue sur origin/main ET le site public avant rédaction.
  Si le commit existe mais pas encore la page publique, reprendre la vérification
  de déploiement du même article ; ne pas créer un second article.
- Lancer les tests Web, le contrôle de types, le lint et le build Web. Examiner le
  diff. Corriger automatiquement les problèmes de l’article ; ne pas modifier
  l’infrastructure ou les fonctionnalités métier pour contourner un échec.
  Cas Windows connu : si la compilation, les types et la génération des pages
  ont réussi mais que seul l’assemblage standalone échoue avec EPERM symlink,
  conserver la configuration de production et faire vérifier l’assemblage Linux
  par Coolify. Ce cas ne vaut pas réussite du build local ; la publication ne
  sera confirmée qu’après le déploiement et les vérifications publiques.
- Committer uniquement les changements éditoriaux nécessaires et pousser vers
  main sans force. En cas de concurrence, relire main et contrôler à nouveau
  l’absence d’article de la semaine avant de réappliquer le changement.
- Attendre le déploiement Coolify avec des vérifications espacées. Vérifier HTTP
  200, titre, canonical, dates structurées, sources, liens internes, présence dans
  /guides et /sitemap.xml, et absence de noindex sur l’article public.
- Ne déclarer la publication réussie qu’après vérification publique. Si l’accès,
  les sources, les tests ou le déploiement échouent, conserver le travail préparé,
  ne pas créer de doublon et signaler précisément le blocage.
- Notifier seulement la publication avec son URL ou un échec/action nécessaire.
  Rester silencieux si l’article de la semaine est déjà publié et vérifié.

## Exécution

La planification est gérée dans Codex, dans la tâche de publication SEO. Elle
utilise les accès GitHub existants. L’ordinateur doit être allumé, le projet
disponible et l’application ouverte. Aucune clé d’API de génération supplémentaire
n’est nécessaire pour ce fonctionnement. Une exécution quand l’ordinateur est
éteint nécessiterait un hébergement distinct du rédacteur automatique.

Premier article préparé le 16 septembre 2026 :
/guides/sms-surtaxe-qui-contacter-remboursement.
