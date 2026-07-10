# Conventions Lydoc

## Langage et qualite

- TypeScript strict partout.
- ESLint et Prettier obligatoires.
- Aucun `any` sans justification locale.
- Les montants sont en centimes.
- Les enums metier sont centralises.
- Les DTO publics sont separes des objets domaine.
- Les tests de use cases ne doivent pas demarrer NestJS.

## Architecture

- Le domaine ne depend d'aucun framework.
- Les use cases orchestrent, les entites metier protegent les invariants.
- Les adapters implementent des ports definis cote application.
- Prisma reste dans l'infrastructure.
- Les controllers restent minces.
- Les erreurs externes sont traduites en erreurs applicatives.

## Donnees sensibles

- Chiffrement obligatoire au stockage.
- Acces document sensibles journalises.
- URL signees courtes.
- Pas de piece d'identite originale transmise dans un dossier.
- Generation systematique d'une copie filigranee.
- Suppression automatique selon politique de retention.

## Produit

- Ne jamais promettre un remboursement.
- Utiliser "montant estimatif recuperable".
- Utiliser "dossier conforme au reglement".
- Demander RIB et piece d'identite uniquement apres decision d'envoi.
- Paiement fixe uniquement au moment d'envoyer un dossier.

