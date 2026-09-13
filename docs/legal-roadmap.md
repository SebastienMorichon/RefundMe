# Feuille de route juridique Lydoc

Derniere mise a jour : 2 aout 2026.

Ce document suit les decisions produit et les points a terminer. Les textes publics restent des projets a faire valider par un professionnel du droit avant une ouverture commerciale.

## Decisions actuelles

- Service reserve aux particuliers majeurs residant en France.
- Inscription obligatoire avant l'analyse.
- Analyse, constitution et telechargement du dossier gratuits.
- Offre d'impression et d'envoi postal desactivee et presentee comme bientot disponible.
- Aucun abonnement, aucune commission sur le remboursement et aucun encaissement des sommes remboursees.
- Obligation de moyens, sans garantie d'acceptation par l'organisateur.
- Les factures operateur ne sont pas transmises a Mistral. Seuls les reglements importes par l'administration peuvent etre analyses par ce prestataire.
- RIB et pieces d'identite filigranes localement puis chiffres, sans analyse par une IA.
- Suppression des documents disponible; suppression du compte sur demande RGPD.
- Contact general et RGPD : contact@lydoc.fr.

## Avant toute ouverture publique

- [x] Retenir le statut d'editeur non professionnel et confirmer que son identite a ete communiquee a l'hebergeur.
- [x] Confirmer que le directeur de la publication est le createur de Lydoc, dont l'anonymat est preserve dans les mentions legales.
- [x] Confirmer l'hebergement : VPS-2 OVHcloud situe en France, donnees applicatives hebergees en France.
- [x] Identifier Philippe Joubert comme responsable de traitement dans la politique de confidentialite.
- [x] Verifier que contact@lydoc.fr recoit les demandes generales et RGPD (test de production recu le 13 septembre 2026).
- [ ] Completer et tenir le registre des activites de traitement.
- [ ] Cartographier les donnees envoyees a OVHcloud, Mistral et au prestataire d'e-mails.
- [ ] Verifier les accords de sous-traitance, localisations et transferts internationaux.
- [ ] Mettre en place la suppression automatique des RIB et pieces d'identite 30 jours apres le premier dossier final.
- [ ] Fixer les autres durees : compte inactif, dossiers, support, journaux et sauvegardes.
- [ ] Documenter la procedure de droits RGPD et de gestion d'une violation de donnees.
- [ ] Faire relire les CGU, la politique de confidentialite et les mentions legales.

## Mesure d'audience et parrainage

- [ ] Choisir une solution de mesure d'audience et verifier si elle peut etre configuree sans consentement selon les criteres CNIL.
- [ ] Sinon, mettre en place une plateforme de consentement avant tout depot de traceur non essentiel.
- [ ] Ne pas activer de campagne commerciale tant que le consentement et le desabonnement ne sont pas traces.
- [ ] Concevoir le parrainage uniquement lors de l'ouverture payante : avantage apres paiement effectif du filleul, regles antifraude et conditions dediees.

## Avant l'ouverture de l'offre payante

- [ ] Declarer l'activite en entreprise individuelle sous regime micro-entrepreneur avant la premiere facturation.
- [ ] Souscrire une assurance responsabilite civile professionnelle adaptee.
- [ ] Definir les prix TTC, la TVA applicable, les frais d'impression et d'affranchissement.
- [ ] Generer et envoyer les factures clients avec une numerotation conforme.
- [ ] Choisir et conventionner avec un mediateur de la consommation.
- [ ] Faire valider les CGV, le formulaire de retractation et le parcours de commande.
- [ ] Ajouter un mandat limite autorisant Lydoc a generer, imprimer et expedier la demande au nom du client.
- [ ] Definir la valeur de la signature au nom du client et la preuve de sa validation finale.
- [ ] Definir le moment exact de debut d'execution et le consentement a l'execution anticipee.
- [ ] Affiner le delai annonce, actuellement envisage a J+2 ou J+3.
- [ ] Formaliser les remboursements, credits et gestes commerciaux selon l'origine d'un echec.
- [ ] Verifier Stripe, le prestataire postal, le suivi, les webhooks et les notifications de bout en bout.
- [ ] Repasser MANAGED_POSTAL_ENABLED et NEXT_PUBLIC_MANAGED_POSTAL_ENABLED a true uniquement apres validation de cette liste.

## Delais de reponse

Un delai de trois a six mois n'est pas retenu. L'objectif provisoire est une reponse circonstanciee sous 30 jours, afin de traiter les reclamations avant qu'une absence de reponse ne permette la saisine du mediateur lorsque l'offre commerciale sera ouverte.
