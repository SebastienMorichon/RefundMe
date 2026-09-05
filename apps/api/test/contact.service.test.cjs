const assert = require("node:assert/strict");
const test = require("node:test");
const {
  BadRequestException,
  ServiceUnavailableException,
} = require("@nestjs/common");
const {
  ContactService,
} = require("../dist/modules/contact/contact.service.js");

const validInput = {
  firstName: "Jeanne",
  lastName: "Martin",
  email: "jeanne@example.test",
  subject: "Autre demande",
  message: "Bonjour, ceci est une demande de test.",
  consentAccepted: true,
  website: "",
};

test("contact validates input and sends PII only in the provider body", async (t) => {
  const originalFetch = globalThis.fetch;
  const previous = {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    to: process.env.CONTACT_TO_EMAIL,
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
    restore("RESEND_API_KEY", previous.apiKey);
    restore("RESEND_FROM_EMAIL", previous.from);
    restore("CONTACT_TO_EMAIL", previous.to);
  });
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Lydoc <from@example.test>";
  process.env.CONTACT_TO_EMAIL = "support@example.test";
  let request;
  globalThis.fetch = async (url, init) => {
    request = { url, init };
    return Response.json({ id: "email-1" });
  };

  await new ContactService(createPrismaMock()).submit(validInput);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.url.includes("jeanne"), false);
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.reply_to, validInput.email);
  assert.match(payload.text, /demande de test/);
  assert.ok(request.init.signal instanceof AbortSignal);
});

test("contact honeypot accepts without calling the provider", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => assert.fail("provider should not be called");
  await new ContactService(createPrismaMock()).submit({ ...validInput, website: "spam.example" });
});

test("contact rejects malformed input and missing provider configuration", async (t) => {
  await assert.rejects(
    new ContactService(createPrismaMock()).submit({ ...validInput, consentAccepted: false }),
    BadRequestException,
  );
  const previous = process.env.RESEND_API_KEY;
  t.after(() => restore("RESEND_API_KEY", previous));
  delete process.env.RESEND_API_KEY;
  await assert.rejects(
    new ContactService(createPrismaMock()).submit(validInput),
    ServiceUnavailableException,
  );
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createPrismaMock() {
  let sequence = 0;
  const contactSubmission = {
    async count() { return 0; },
    async create() { sequence += 1; return { id: `contact-${sequence}` }; },
    async deleteMany() { return { count: 0 }; },
    async updateMany() { return { count: 1 }; },
  };
  return {
    contactSubmission,
    async $transaction(callback) {
      return callback({
        contactSubmission,
        async $executeRaw() { return 1; },
      });
    },
  };
}
