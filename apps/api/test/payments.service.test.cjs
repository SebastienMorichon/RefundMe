const assert = require("node:assert/strict");
const test = require("node:test");
const { checkoutMatchesPayment } = require("../dist/modules/payments/payments.service.js");

const payment = {
  caseId: "case-1",
  amountCents: 299,
  currency: "eur",
  stripeCheckoutSession: "cs_test_valid",
};
const session = {
  id: "cs_test_valid",
  amount_total: 299,
  currency: "eur",
  metadata: { caseId: "case-1" },
};

test("accepts a checkout only when case, session, amount and currency match", () => {
  assert.equal(checkoutMatchesPayment(payment, session), true);
});

test("rejects a checkout with altered payment data", () => {
  assert.equal(checkoutMatchesPayment(payment, { ...session, amount_total: 1 }), false);
  assert.equal(checkoutMatchesPayment(payment, { ...session, id: "cs_test_other" }), false);
  assert.equal(checkoutMatchesPayment(payment, { ...session, metadata: { caseId: "case-2" } }), false);
});
