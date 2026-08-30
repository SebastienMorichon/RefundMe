const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canRequestPostalExpenseReimbursement,
  readPostalExpenseReimbursement,
} = require("../dist/modules/rules/postal-expense-reimbursement.js");

test("accepts postage and printing terms for a refund request", () => {
  const terms = readPostalExpenseReimbursement({
    available: true,
    appliesTo: "REFUND_REQUEST",
    postage: {
      reimbursable: true,
      amountCents: null,
      basis: "tarif lettre verte moins de 20 g",
    },
    printing: {
      reimbursable: true,
      centsPerPage: 15,
      maxPages: 10,
      basis: "0,15 EUR par page",
    },
    claimLimit: {
      scope: "PER_HOUSEHOLD_PER_GAME",
      strict: true,
      details: "une seule demande par foyer pour toute la duree du jeu",
    },
    requestInstructions: "demande expresse dans le meme courrier",
    requiredProofs: ["preuve d'affranchissement"],
    sourceReference: "Article 6",
  });

  assert.equal(canRequestPostalExpenseReimbursement(terms), true);
  assert.equal(terms.printing.centsPerPage, 15);
  assert.equal(terms.claimLimit.scope, "PER_HOUSEHOLD_PER_GAME");
  assert.equal(terms.claimLimit.strict, true);
});

test("does not offer postage that only concerns a copy of the rules", () => {
  const terms = readPostalExpenseReimbursement({
    available: true,
    appliesTo: "RULE_COPY_REQUEST",
    postage: { reimbursable: true, amountCents: 152, basis: "tarif lent" },
    printing: { reimbursable: false },
    claimLimit: { scope: "PER_HOUSEHOLD_PER_GAME", strict: true },
  });

  assert.equal(terms.available, true);
  assert.equal(canRequestPostalExpenseReimbursement(terms), false);
});
