const assert = require("node:assert/strict");
const test = require("node:test");
const {
  checkoutIdempotencyKey,
  checkoutMatchesPayment,
  isReusableCheckoutSession,
} = require("../dist/modules/payments/payments.service.js");
const { missingCustomerProfileFields } = require("../dist/modules/identity/customer-profile.js");

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

test("uses a stable Stripe idempotency key for one quote attempt", () => {
  const input = {
    caseId: "case-1",
    amountCents: 799,
    shipmentUpdatedAt: new Date("2026-08-03T10:00:00.000Z"),
    paymentUpdatedAt: null,
  };
  const first = checkoutIdempotencyKey(input);
  assert.equal(checkoutIdempotencyKey(input), first);
  assert.ok(first.length <= 255);
  assert.notEqual(
    checkoutIdempotencyKey({
      ...input,
      paymentUpdatedAt: new Date("2026-08-03T10:01:00.000Z"),
    }),
    first,
  );
});

test("reuses only the exact still-open unpaid checkout session", () => {
  const pendingPayment = { ...payment, status: "PENDING" };
  const openSession = {
    ...session,
    status: "open",
    payment_status: "unpaid",
    url: "https://checkout.stripe.com/c/pay/cs_test_valid",
  };
  assert.equal(
    isReusableCheckoutSession(pendingPayment, openSession),
    true,
  );
  assert.equal(
    isReusableCheckoutSession(pendingPayment, {
      ...openSession,
      status: "expired",
    }),
    false,
  );
  assert.equal(
    isReusableCheckoutSession(
      { ...pendingPayment, amountCents: 1 },
      openSession,
    ),
    false,
  );
});

test("requires the customer identity and contact details before checkout", () => {
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
