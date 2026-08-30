const assert = require("node:assert/strict");
const test = require("node:test");
const {
  NotificationsService,
} = require("../dist/modules/notifications/notifications.service.js");

test("sends a Resend email with a stable idempotency key", async () => {
  const previous = {
    key: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    app: process.env.APP_URL,
  };
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "Lydoc <notifications@example.com>";
  process.env.APP_URL = "https://app.example.com";
  const requests = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ id: "email-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const updates = [];
  const prisma = {
    administrativeCase: {
      findUnique: async () => ({
        id: "case-1",
        owner: { id: "user-1", email: "client@example.com", firstName: "Jean" },
        gameRule: { name: "Jeu M6" },
      }),
    },
    notificationDelivery: {
      findUnique: async () => null,
      upsert: async () => ({ id: "delivery-1" }),
      update: async (input) => {
        updates.push(input);
        return input;
      },
    },
    auditLog: { create: async (input) => input },
    $transaction: async (operations) => Promise.all(operations),
  };

  try {
    await new NotificationsService(prisma).sendCaseEvent(
      "case-1",
      "CASE_VALIDATED",
    );
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.resend.com/emails");
    assert.equal(
      requests[0].init.headers["Idempotency-Key"],
      "CASE_VALIDATED:case-1",
    );
    assert.equal(updates[0].data.status, "SENT");
  } finally {
    global.fetch = previousFetch;
    restoreEnv("RESEND_API_KEY", previous.key);
    restoreEnv("RESEND_FROM_EMAIL", previous.from);
    restoreEnv("APP_URL", previous.app);
  }
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
