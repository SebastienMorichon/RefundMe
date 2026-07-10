const assert = require("node:assert/strict");
const test = require("node:test");
const { AnalyzeOrangeInvoiceEligibility } = require("../dist/use-cases/eligibility/analyze-orange-invoice-eligibility.js");

test("matches a current approved Orange rule from printable invoice text", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    bytes: Buffer.from("Facture Orange. Une participation SMS au jeu ete detectee."),
    approvedRules: [{
      id: "rule-1",
      organizerName: "Orange",
      name: "Jeu TV Avril",
      reimbursementCents: 1490,
      requiredDocuments: [{ kind: "BANK_DETAILS", label: "RIB", required: true }],
      constraints: { keywords: ["jeu"] },
    }],
  });

  assert.equal(analysis.isOrangeInvoice, true);
  assert.equal(analysis.candidates.length, 1);
  assert.equal(analysis.candidates[0].ruleId, "rule-1");
  assert.deepEqual(analysis.candidates[0].missingRequirements, ["RIB"]);
});

test("does not match a rule outside its validity window", () => {
  const analysis = new AnalyzeOrangeInvoiceEligibility().execute({
    bytes: Buffer.from("Facture Orange"),
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
