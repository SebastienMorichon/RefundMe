# Import automatisé des règlements

La veille envoie chaque règlement exploitable à `POST /automation/rules` avec
un en-tête `Authorization: Bearer <RULE_AUTOMATION_TOKEN>`. Ce secret doit être
aléatoire, dédié, long d'au moins 32 caractères et présent uniquement dans
l'environnement de l'API et de la veille.

Chaque import est créé avec le statut `NEEDS_REVIEW`. Un règlement approuvé qui
change revient automatiquement en relecture. Une source inchangée renvoie
`action: "unchanged"` sans créer de doublon. L'URL officielle normalisée sert
d'identifiant stable et une empreinte du contenu détecte les modifications.

Exemple de charge utile :

```json
{
  "sourceUrl": "https://organisateur.example/reglement-jeu",
  "organizerName": "Organisateur",
  "name": "Jeu SMS de septembre",
  "reimbursementCents": 80,
  "validFrom": "2026-09-01",
  "validUntil": "2026-09-30",
  "requiredDocuments": [
    {
      "kind": "ORANGE_INVOICE",
      "label": "Facture téléphonique détaillée",
      "required": true
    },
    { "kind": "BANK_DETAILS", "label": "RIB", "required": true }
  ],
  "constraints": {
    "channelName": "Chaîne ou marque",
    "participationMechanism": "SMS+",
    "reimbursementDeadline": "Dans les 30 jours suivant la participation",
    "reimbursementAddress": "Adresse reprise du règlement officiel",
    "sourceReferences": ["Article 8 — Remboursement"]
  }
}
```

Depuis la racine du projet, le client fourni accepte un fichier JSON ou l'entrée
standard :

```powershell
node scripts/import-game-rule.mjs --file chemin/vers/reglement.json
```

Le client ne journalise jamais le jeton. Sa sortie contient seulement l'action,
l'identifiant de la fiche et son statut.

La veille locale peut cibler la production avec
`RULE_AUTOMATION_API_URL=https://api.lydoc.fr` sans remplacer l'`API_URL`
utilisée par le développement local.
