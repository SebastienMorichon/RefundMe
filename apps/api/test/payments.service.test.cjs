const assert = require("node:assert/strict");
const test = require("node:test");
const {
  checkoutReference,
  isReusableSumUpCheckout,
  isSuccessfulSumUpCheckout,
  sumUpCheckoutMatchesPayment,
} = require("../dist/modules/payments/payments.service.js");
const { missingCustomerProfileFields } = require("../dist/modules/identity/customer-profile.js");

const payment = {
  amountCents: 251,
  currency: "eur",
  providerCheckoutId: "sumup-1",
  providerReference: "lydoc-case-1-reference",
};
const checkout = {
  id: "sumup-1",
  checkout_reference: "lydoc-case-1-reference",
  amount: 2.51,
  currency: "EUR",
};

test("accepts a SumUp checkout only when id, reference, amount and currency match", () => {
  assert.equal(sumUpCheckoutMatchesPayment(payment, checkout), true);
  assert.equal(sumUpCheckoutMatchesPayment(payment, { ...checkout, amount: 2.5 }), false);
  assert.equal(sumUpCheckoutMatchesPayment(payment, { ...checkout, id: "sumup-2" }), false);
});

test("requires an authoritative successful transaction before fulfillment", () => {
  assert.equal(isSuccessfulSumUpCheckout({ status: "PAID", transactions: [] }), false);
  assert.equal(isSuccessfulSumUpCheckout({ status: "PAID", transactions: [{ status: "SUCCESSFUL" }] }), true);
});

test("uses a stable unique SumUp reference for one quote attempt", () => {
  const input = {
    caseId: "case-1",
    amountCents: 251,
    shipmentUpdatedAt: new Date("2026-09-11T10:00:00.000Z"),
    paymentUpdatedAt: null,
  };
  const first = checkoutReference(input);
  assert.equal(checkoutReference(input), first);
  assert.ok(first.length <= 64);
  assert.notEqual(checkoutReference({ ...input, amountCents: 250 }), first);
});

test("reuses only the exact pending hosted SumUp checkout", () => {
  assert.equal(isReusableSumUpCheckout({ ...payment, status: "PENDING" }, {
    ...checkout,
    status: "PENDING",
    hosted_checkout_url: "https://checkout.sumup.com/example",
  }), true);
  assert.equal(isReusableSumUpCheckout({ ...payment, status: "PENDING" }, {
    ...checkout,
    status: "PAID",
    hosted_checkout_url: "https://checkout.sumup.com/example",
  }), false);
});

test("requires customer identity and contact details before checkout", () => {
  const completeProfile = {
    firstName: "Jean",
    lastName: "Dupont",
    postalAddress: "12 rue de la Republique",
    postalCode: "75001",
    city: "Paris",
    country: "France",
    phoneNumber: "06 12 34 56 78",
    operatorCustomerReference: null,
  };
  assert.deepEqual(missingCustomerProfileFields(completeProfile), []);
  assert.deepEqual(missingCustomerProfileFields({ ...completeProfile, phoneNumber: null }), ["Numero de telephone participant"]);
});
