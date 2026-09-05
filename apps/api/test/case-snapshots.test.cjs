const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createCaseRuleSnapshot,
  createCustomerSnapshot,
  readCaseValidationSnapshot,
} = require("../dist/modules/eligibility/case-snapshots.js");

test("keeps the case rule unchanged when the source rule is edited later", () => {
  const rule = {
    id: "rule-1",
    version: 3,
    name: "Jeu SMS Orange",
    reimbursementCents: 1794,
    requiredDocuments: [{ kind: "ORANGE_INVOICE", label: "Facture", required: true }],
    constraintsJson: { reimbursementAddress: "Paris" },
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: null,
    reviewedAt: new Date("2026-02-01T00:00:00.000Z"),
    organizer: { name: "Orange" },
  };

  const snapshot = createCaseRuleSnapshot(rule, new Date("2026-03-01T00:00:00.000Z"));
  rule.name = "Nom modifie";
  rule.constraintsJson.reimbursementAddress = "Lyon";

  assert.equal(snapshot.name, "Jeu SMS Orange");
  assert.equal(snapshot.constraints.reimbursementAddress, "Paris");
  assert.equal(snapshot.version, 3);
});

test("reads a complete customer confirmation snapshot", () => {
  const rule = createCaseRuleSnapshot({
    id: "rule-1",
    version: 1,
    name: "Jeu",
    reimbursementCents: 500,
    requiredDocuments: [],
    constraintsJson: {},
    validFrom: null,
    validUntil: null,
    reviewedAt: null,
    organizer: { name: "Organisateur" },
  });
  const customer = createCustomerSnapshot({
    email: "client@example.com",
    firstName: "Jean",
    lastName: "Dupont",
    postalAddress: "1 rue Exemple",
    postalCode: "75001",
    city: "Paris",
    country: "France",
    phoneNumber: "0612345678",
    operatorCustomerReference: null,
  });
  const value = {
    version: 1,
    confirmedAt: "2026-03-02T00:00:00.000Z",
    rule,
    customer,
    documents: [{ id: "doc-1", kind: "ORANGE_INVOICE", originalName: "facture.pdf" }],
    estimatedRecoverableCents: 500,
    serviceFeeCents: 299,
    postalExpenseClaim: {
      requested: true,
      selectedAt: "2026-03-02T00:00:00.000Z",
      terms: {
        available: true,
        appliesTo: "REFUND_REQUEST",
        postage: { reimbursable: true, amountCents: null, basis: "tarif lent" },
        printing: { reimbursable: true, centsPerPage: 15, maxPages: null, basis: "" },
        claimLimit: { scope: "PER_PARTICIPANT_PER_GAME", strict: true, details: "une demande par jeu" },
        requestInstructions: "demande expresse",
        requiredProofs: [],
        sourceReference: "Article 6",
      },
    },
  };

  assert.deepEqual(readCaseValidationSnapshot(value), value);
});
