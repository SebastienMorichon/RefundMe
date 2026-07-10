const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const test = require("node:test");

process.env.SESSION_SECRET = "test-session-secret";
const { SessionService } = require("../dist/modules/identity/session.service.js");

test("returns the signed session user while it is valid", () => {
  const sessions = new SessionService();
  const value = sessions.createCookieValue({ id: "user-1", email: "user@example.com", role: "USER" });

  assert.deepEqual(sessions.readCookieValue(value), {
    id: "user-1",
    email: "user@example.com",
    role: "USER",
  });
});

test("rejects an expired session even when its signature is valid", () => {
  const payload = Buffer.from(
    JSON.stringify({ id: "user-1", email: "user@example.com", role: "USER", expiresAt: Date.now() - 1 }),
  ).toString("base64url");
  const signature = createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  const sessions = new SessionService();

  assert.equal(sessions.readCookieValue(`${payload}.${signature}`), null);
});
