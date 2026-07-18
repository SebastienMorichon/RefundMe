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
