const assert = require("node:assert/strict");
const test = require("node:test");
const { AnalyzeOrangeInvoiceEligibility } = require("../dist/use-cases/eligibility/analyze-orange-invoice-eligibility.js");

test("matches a current approved rule from SMS+ invoice rows and uses invoiced amount", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Orange France",
      "Facture mobile detaillee",
      "03/06/2026 20:48 SMS+ Jeu M6 - Top Chef - Participation remboursable sur demande 72121 4 SMS 2,99 EUR 11,96 EUR",
      "22/06/2026 18:04 Achat multimedia App Store - abonnement musique - 1 7,50 EUR 7,50 EUR",
    ].join("\n"),
    approvedRules: [{
      id: "rule-1",
      organizerName: "M6",
      name: "Top Chef",
      reimbursementCents: 15000000,
      requiredDocuments: [{ kind: "BANK_DETAILS", label: "RIB", required: true }],
      constraints: { keywords: ["top chef"] },
    }],
  });

  assert.equal(analysis.isOrangeInvoice, true);
  assert.equal(analysis.participationCount, 4);
  assert.equal(analysis.detectedSmsCharges.length, 1);
  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].ruleId, "rule-1");
  assert.equal(analysis.candidates[0].reimbursementCents, 1196);
  assert.deepEqual(analysis.candidates[0].missingRequirements, ["RIB"]);
});

test("does not match a rule outside its validity window", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: "Facture Orange",
    approvedRules: [{
      id: "rule-1",
      organizerName: "Orange",
      name: "Jeu termine",
      reimbursementCents: 1490,
      requiredDocuments: [],
      constraints: {},
      validUntil: new Date("2025-01-01T00:00:00.000Z"),
    }],
    now: new Date("2026-01-01T00:00:00.000Z"),
  });

  assert.equal(analysis.candidates.length, 0);
});

test("does not create a false FIFA case from a different M6 SMS game", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Orange France",
      "Facture mobile detaillee",
      "03/06/2026 20:48 SMS+ Jeu M6 - Top Chef - Participation remboursable sur demande 72121 4 SMS 2,99 EUR 11,96 EUR",
    ].join("\n"),
    approvedRules: [{
      id: "rule-fifa",
      organizerName: "M6",
      name: "FIFA 2026",
      reimbursementCents: 15000000,
      requiredDocuments: [],
      constraints: { keywords: ["fifa", "football"] },
    }],
  });

  assert.equal(analysis.participationCount, 4);
  assert.equal(analysis.detectedSmsCharges[0].amountCents, 1196);
  assert.equal(analysis.candidates.length, 0);
});

test("keeps only real SMS+ rows from Mistral markdown tables", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "| Libelle | Montant HT | TVA | Montant TTC |",
      "| Achats multimedia et SMS+ jeux | 21,20 EUR | 20 % | 25,44 EUR |",
      "| Date | Heure | Service facture | Code court | Quantite | Prix unitaire | Total TTC |",
      "| 03/06/2026 | 20:48 | SMS+ Jeu M6 - Top Chef - Participation remboursable sur demande | 72121 | 4 SMS | 2,99 EUR | 11,96 EUR |",
      "| 07/06/2026 | 21:17 | SMS+ Jeu TF1 - The Voice - Vote/jeu antenne, remboursement possible | 72500 | 2 SMS | 1,49 EUR | 2,98 EUR |",
      "| 14/06/2026 | 19:52 | SMS+ Jeu France TV - Question du jour, conditions sur reglement | 73030 | 1 SMS | 3,00 EUR | 3,00 EUR |",
      "| SMS potentiellement remboursables | 7 SMS jeux pour un montant total de 17,94 EUR |",
    ].join("\n"),
    approvedRules: [],
  });

  assert.equal(analysis.detectedSmsCharges.length, 3);
  assert.equal(analysis.participationCount, 7);
  assert.equal(analysis.detectedSmsCharges.reduce((total, charge) => total + charge.amountCents, 0), 1794);
});

test("detects Bouygues SMS+ rows whose section and charge details are split by OCR", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Bouygues Telecom",
      "Facture du 23 juillet 2026",
      "| · 3 unités de Achats SMS+ | | | 20,00 | 2,48 | **2,97** |",
      "**Achats SMS+** 2,97",
      "| Date | Heure | Type | Nom du service | Coût € TTC* |",
      "| 14/07 | 21:18:14 | Achat à l'acte | Acte-74600-M6WEB | 0,990 |",
      "| 14/07 | 21:19:59 | Achat à l'acte | Acte-74600-M6WEB | 0,990 |",
      "| 14/07 | 21:21:15 | Achat à l'acte | Acte-74600-M6WEB | 0,990 |",
    ].join("\n"),
    approvedRules: [],
  });

  assert.equal(analysis.isOrangeInvoice, false);
  assert.equal(analysis.isTelecomInvoice, true);
  assert.equal(analysis.operatorName, "Bouygues Telecom");
  assert.equal(analysis.participationCount, 3);
  assert.equal(analysis.detectedSmsCharges.length, 3);
  assert.deepEqual(analysis.detectedSmsCharges.map((charge) => charge.code), ["74600", "74600", "74600"]);
  assert.deepEqual(analysis.detectedSmsCharges.map((charge) => charge.occurredOn), [
    "2026-07-14",
    "2026-07-14",
    "2026-07-14",
  ]);
  assert.equal(analysis.detectedSmsCharges.reduce((total, charge) => total + charge.amountCents, 0), 297);
});

test("uses the SMS date to match an approved M6 rule after the game has ended", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Bouygues Telecom",
      "Facture du 23 juillet 2026",
      "**Achats SMS+** 2,97",
      "| 14/07 | 21:18:14 | Achat a l'acte | Acte-74600-M6WEB | 0,990 |",
      "| 14/07 | 21:19:59 | Achat a l'acte | Acte-74600-M6WEB | 0,990 |",
      "| 14/07 | 21:21:15 | Achat a l'acte | Acte-74600-M6WEB | 0,990 |",
    ].join("\n"),
    approvedRules: [{
      id: "rule-fifa",
      organizerName: "M6 DISTRIBUTION DIGITAL",
      name: "COUPE DU MONDE FIFA 2026",
      reimbursementCents: 0,
      requiredDocuments: [
        { kind: "IDENTITY_DOCUMENT", label: "Copie de la piece d'identite", required: true },
        { kind: "PURCHASE_PROOF", label: "Facture detaillee de l'operateur", required: true },
        { kind: "BANK_DETAILS", label: "RIB", required: true },
      ],
      constraints: { participationMechanism: "SMS ou site web" },
      validFrom: new Date("2026-06-11T00:00:00.000Z"),
      validUntil: new Date("2026-07-19T00:00:00.000Z"),
    }],
    now: new Date("2026-07-27T12:00:00.000Z"),
  });

  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].ruleId, "rule-fifa");
  assert.equal(analysis.candidates[0].reimbursementCents, 297);
  assert.deepEqual(analysis.candidates[0].missingRequirements, [
    "Copie de la piece d'identite",
    "Facture detaillee de l'operateur",
    "RIB",
  ]);
  assert.match(analysis.candidates[0].evidence.join(" "), /Reglement unique/);
});

test("does not guess between two overlapping M6 rules from an opaque operator label", () => {
  const rule = {
    organizerName: "M6 DISTRIBUTION DIGITAL",
    reimbursementCents: 0,
    requiredDocuments: [],
    constraints: {},
    validFrom: new Date("2026-06-11T00:00:00.000Z"),
    validUntil: new Date("2026-07-19T00:00:00.000Z"),
  };
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Bouygues Telecom",
      "Facture du 23 juillet 2026",
      "**Achats SMS+** 0,99",
      "| 14/07 | 21:18:14 | Achat a l'acte | Acte-74600-M6WEB | 0,990 |",
    ].join("\n"),
    approvedRules: [
      { ...rule, id: "rule-fifa", name: "COUPE DU MONDE FIFA 2026" },
      { ...rule, id: "rule-cuisine", name: "LE GRAND JEU CUISINE" },
    ],
    now: new Date("2026-07-27T12:00:00.000Z"),
  });

  assert.equal(analysis.candidates.length, 0);
});

test("uses the contest explicitly selected by the customer when two M6 rules share a short code", () => {
  const sharedRule = {
    organizerName: "M6 DISTRIBUTION DIGITAL",
    reimbursementCents: 0,
    requiredDocuments: [],
    constraints: { keywords: ["74 600"] },
    validFrom: new Date("2026-07-01T00:00:00.000Z"),
    validUntil: new Date("2026-12-31T00:00:00.000Z"),
  };
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Bouygues Telecom",
      "Facture du 23 juillet 2026",
      "**Achats SMS+** 1,98",
      "| 14/07 | 21:18:14 | Achat a l'acte | Acte-74600-M6WEB | 0,990 |",
      "| 14/07 | 21:19:59 | Achat a l'acte | Acte-74600-M6WEB | 0,990 |",
    ].join("\n"),
    approvedRules: [
      { ...sharedRule, id: "rule-fifa", name: "COUPE DU MONDE FIFA 2026" },
      { ...sharedRule, id: "rule-prime", name: "PRIME-TIME" },
    ],
    selectedRuleId: "rule-prime",
  });

  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].ruleId, "rule-prime");
  assert.equal(analysis.candidates[0].reimbursementCents, 198);
  assert.match(analysis.candidates[0].evidence.join(" "), /selectionne par le client/i);
});

test("uses the short code and M6 alias to match an approved rule", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Bouygues Telecom",
      "**Achats SMS+** 0,99",
      "| 14/07 | 21:18:14 | Achat à l'acte | Acte-74600-M6WEB | 0,990 |",
    ].join("\n"),
    approvedRules: [{
      id: "rule-m6",
      organizerName: "METROPOLE TELEVISION",
      name: "Jeu antenne M6",
      reimbursementCents: 99,
      requiredDocuments: [],
      constraints: {
        participationMechanism: "SMS au 74600",
        keywords: ["M6WEB"],
      },
    }],
  });

  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].ruleId, "rule-m6");
  assert.equal(analysis.candidates[0].reimbursementCents, 99);
  assert.match(analysis.candidates[0].evidence.join(" "), /Code court detecte: 74600/);
});

test("does not treat a reimbursement postal code as an SMS short code", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    text: [
      "Bouygues Telecom",
      "**Achats SMS+** 0,99",
      "| 14/07 | 21:18:14 | Achat à l'acte | Acte-92575-M6WEB | 0,990 |",
    ].join("\n"),
    approvedRules: [{
      id: "rule-postal",
      organizerName: "METROPOLE TELEVISION",
      name: "Jeu antenne",
      reimbursementCents: 99,
      requiredDocuments: [],
      constraints: {
        reimbursementAddress: "89 Avenue Charles de Gaulle, 92575 Neuilly-sur-Seine Cedex",
      },
    }],
  });

  assert.equal(analysis.detectedSmsCharges.length, 1);
  assert.equal(analysis.candidates.length, 0);
});
