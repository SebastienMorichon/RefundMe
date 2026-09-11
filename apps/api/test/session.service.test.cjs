const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");

process.env.SESSION_SECRET =
  "test-session-secret-with-at-least-thirty-two-characters";

const {
  CURRENT_LEGAL_CONSENT_VERSION,
  IdentityController,
} = require("../dist/modules/identity/identity.controller.js");
const {
  NodePasswordHasher,
} = require("../dist/modules/identity/node-password-hasher.service.js");
const {
  IdentityEmailService,
} = require("../dist/modules/identity/identity-email.service.js");
const {
  IdentityTokenService,
  InvalidCurrentPasswordError,
  InvalidIdentityTokenError,
} = require("../dist/modules/identity/identity-token.service.js");
const {
  SessionService,
} = require("../dist/modules/identity/session.service.js");
const {
  createCsrfProtection,
  createDefaultJsonBodyParser,
  createIdentifierRateLimiter,
  createRateLimiter,
  normalizeRequestPath,
  parseTrustedProxyCidrs,
} = require("../dist/platform/http-protection.js");

const csrfOptions = {
  cookieName: "lydoc_csrf",
  validateToken(cookieValue, headerValue) {
    return cookieValue === "valid-token" && headerValue === "valid-token";
  },
};

function createPrismaHarness() {
  let nextSessionId = 1;
  const users = new Map([
    [
      "user-1",
      {
        id: "user-1",
        email: "user@example.com",
        role: "USER",
        emailVerifiedAt: new Date(),
      },
    ],
  ]);
  const sessionRecords = new Map();

  const prisma = {
    user: {
      async findUnique({ where, select }) {
        const user = users.get(where.id);
        return user ? selectRecord(user, select) : null;
      },
    },
    userSession: {
      async create({ data, include }) {
        const user = users.get(data.userId);
        assert.ok(user, "the session user must exist");
        const record = {
          id: `session-${nextSessionId++}`,
          ...data,
          revokedAt: null,
          createdAt: new Date(),
        };
        sessionRecords.set(record.tokenHash, record);
        return { ...record, user: selectRecord(user, include.user.select) };
      },
      async findUnique({ where, include }) {
        const record = sessionRecords.get(where.tokenHash);
        if (!record) return null;
        const user = users.get(record.userId);
        return user
          ? { ...record, user: selectRecord(user, include.user.select) }
          : null;
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const record of sessionRecords.values()) {
          if (where.id !== undefined && record.id !== where.id) continue;
          if (where.userId !== undefined && record.userId !== where.userId)
            continue;
          if (where.revokedAt === null && record.revokedAt !== null) continue;
          Object.assign(record, data);
          count += 1;
        }
        return { count };
      },
    },
  };

  return { prisma, sessionRecords, users };
}

function createIdentityPrismaHarness() {
  let nextTokenId = 1;
  const users = new Map();
  const tokens = new Map();
  const sessions = new Map();
  const audits = [];

  const prisma = {
    user: {
      async findUnique({ where, select }) {
        const user = where.id
          ? users.get(where.id)
          : Array.from(users.values()).find(
              (item) => item.email === where.email,
            );
        return user ? selectRecord(user, select) : null;
      },
      async update({ where, data, select }) {
        const user = users.get(where.id);
        assert.ok(user);
        Object.assign(user, data);
        return selectRecord(user, select);
      },
      async updateMany({ where, data }) {
        const user = users.get(where.id);
        if (
          !user ||
          (where.passwordHash && user.passwordHash !== where.passwordHash) ||
          (where.emailVerifiedAt === null && user.emailVerifiedAt !== null)
        ) {
          return { count: 0 };
        }
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    identityToken: {
      async findFirst({ where, select }) {
        const token = Array.from(tokens.values()).find((item) =>
          identityTokenMatches(item, where),
        );
        return token ? selectRecord(token, select) : null;
      },
      async findUnique({ where, include, select }) {
        const token = tokens.get(where.tokenHash);
        if (!token) return null;
        if (select?.user) {
          const user = users.get(token.userId);
          return {
            ...selectRecord(token, select),
            user: selectRecord(user, select.user.select),
          };
        }
        if (!include?.user) return { ...token };
        const user = users.get(token.userId);
        const userValue = include.user.select
          ? selectRecord(user, include.user.select)
          : { ...user };
        return { ...token, user: userValue };
      },
      async create({ data }) {
        const token = {
          id: `identity-token-${nextTokenId++}`,
          ...data,
          usedAt: null,
          createdAt: new Date(),
        };
        tokens.set(token.tokenHash, token);
        return { ...token };
      },
      async updateMany({ where, data }) {
        let count = 0;
        for (const token of tokens.values()) {
          if (!identityTokenMatches(token, where)) continue;
          Object.assign(token, data);
          count += 1;
        }
        return { count };
      },
    },
    userSession: {
      async updateMany({ where, data }) {
        let count = 0;
        for (const session of sessions.values()) {
          if (where.userId && session.userId !== where.userId) continue;
          if (where.id?.not && session.id === where.id.not) continue;
          if (where.revokedAt === null && session.revokedAt !== null) continue;
          Object.assign(session, data);
          count += 1;
        }
        return { count };
      },
    },
    auditLog: {
      async create({ data }) {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      },
      async createMany({ data }) {
        audits.push(...data);
        return { count: data.length };
      },
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return { audits, prisma, sessions, tokens, users };
}

function createIdentityTokenDependencies(deliveries = []) {
  return {
    outbox: {
      async enqueue(_transaction, input) {
        deliveries.push(input);
      },
      kick() {},
    },
    budgets: { async consume() {} },
  };
}

function selectRecord(record, select) {
  if (!select) return { ...record };
  return Object.fromEntries(
    Object.entries(select)
      .filter(([, included]) => included)
      .map(([key]) => [key, record[key]]),
  );
}

function identityTokenMatches(token, where) {
  if (where.id && token.id !== where.id) return false;
  if (where.userId && token.userId !== where.userId) return false;
  if (where.purpose && token.purpose !== where.purpose) return false;
  if (where.usedAt === null && token.usedAt !== null) return false;
  if (where.expiresAt?.gt && token.expiresAt <= where.expiresAt.gt)
    return false;
  if (where.createdAt?.gt && token.createdAt <= where.createdAt.gt)
    return false;
  return true;
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function createResponse() {
  return {
    headers: new Map(),
    statusCode: 200,
    body: undefined,
    setHeader(name, value) {
      this.headers.set(name.toLowerCase(), value);
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest({
  path,
  method = "POST",
  ip = "203.0.113.10",
  body,
  headers = {},
}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  return {
    path,
    method,
    ip,
    body,
    headers: normalizedHeaders,
    socket: { remoteAddress: ip },
    header(name) {
      return normalizedHeaders[name.toLowerCase()];
    },
  };
}

async function assertRejectedWithStatus(promise, statusCode, message) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.getStatus(), statusCode);
    assert.equal(error.getResponse().message, message);
    return true;
  });
}

test("stores only a keyed session-token hash and reloads the current database role", async () => {
  const harness = createPrismaHarness();
  const sessions = new SessionService(harness.prisma);
  const created = await sessions.createSession("user-1");
  const [stored] = harness.sessionRecords.values();

  assert.match(created.cookieValue, /^[A-Za-z0-9_-]{43}$/);
  assert.match(stored.tokenHash, /^[a-f0-9]{64}$/);
  assert.ok(stored.lastSeenAt instanceof Date);
  assert.notEqual(stored.tokenHash, created.cookieValue);
  assert.deepEqual((await sessions.readCookieValue(created.cookieValue)).user, {
    id: "user-1",
    email: "user@example.com",
    role: "USER",
  });

  harness.users.get("user-1").role = "ADMIN";
  assert.equal(await sessions.readCookieValue(created.cookieValue), null);
  harness.users.get("user-1").role = "USER";
  harness.users.get("user-1").accountDeletedAt = new Date();
  assert.equal(await sessions.readCookieValue(created.cookieValue), null);
  harness.users.get("user-1").accountDeletedAt = null;
  harness.users.get("user-1").emailVerifiedAt = null;
  assert.equal(await sessions.readCookieValue(created.cookieValue), null);
});

test("revokes one session and all sessions server-side", async () => {
  const harness = createPrismaHarness();
  const sessions = new SessionService(harness.prisma);
  const first = await sessions.createSession("user-1");
  const second = await sessions.createSession("user-1");

  await sessions.revokeSession(first.id, "user-1");
  assert.equal(await sessions.readCookieValue(first.cookieValue), null);
  assert.ok(await sessions.readCookieValue(second.cookieValue));

  await sessions.revokeAllSessions("user-1");
  assert.equal(await sessions.readCookieValue(second.cookieValue), null);
});

test("rejects malformed and expired opaque session tokens", async () => {
  const harness = createPrismaHarness();
  const sessions = new SessionService(harness.prisma);
  const created = await sessions.createSession("user-1");
  const [stored] = harness.sessionRecords.values();

  assert.equal(await sessions.readCookieValue("not-a-session-token"), null);
  stored.expiresAt = new Date(Date.now() - 1);
  assert.equal(await sessions.readCookieValue(created.cookieValue), null);
});

test("cannot create a database session for an unverified account", async () => {
  const harness = createPrismaHarness();
  harness.users.get("user-1").emailVerifiedAt = null;
  const sessions = new SessionService(harness.prisma);

  await assert.rejects(
    () => sessions.createSession("user-1"),
    /verified e-mail is required/i,
  );
  assert.equal(harness.sessionRecords.size, 0);
});

test("uses a __Host- cookie name in production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const sessions = new SessionService(createPrismaHarness().prisma);
    assert.equal(sessions.cookieName, "__Host-lydoc_session");
    assert.equal(sessions.csrfCookieName, "__Host-lydoc_csrf");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("issues unpredictable signed CSRF tokens and rejects tampering", () => {
  const sessions = new SessionService(createPrismaHarness().prisma);
  const first = sessions.createCsrfToken();
  const second = sessions.createCsrfToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(sessions.validateCsrfToken(first, first), true);
  assert.equal(sessions.validateCsrfToken(first, second), false);
  const replacement = first.endsWith("A") ? "B" : "A";
  const tampered = `${first.slice(0, -1)}${replacement}`;
  assert.equal(sessions.validateCsrfToken(tampered, tampered), false);
  assert.equal(sessions.validateCsrfToken(undefined, first), false);
});

test("GET /auth/csrf returns the header token and an HttpOnly __Host- cookie", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const sessions = new SessionService(createPrismaHarness().prisma);
    const controller = new IdentityController({}, {}, sessions);
    const response = createResponse();
    const result = controller.csrf(response);
    const cookie = response.headers.get("set-cookie");

    assert.equal(
      sessions.validateCsrfToken(result.csrfToken, result.csrfToken),
      true,
    );
    assert.match(cookie, /^__Host-lydoc_csrf=/);
    assert.match(cookie, /; HttpOnly;/);
    assert.match(cookie, /; SameSite=Strict;/);
    assert.match(cookie, /; Path=\//);
    assert.match(cookie, /; Secure$/);
    assert.doesNotMatch(cookie, /Domain=/i);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("logout and logout-all revoke database sessions and expire the production cookie", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const calls = [];
  const sessions = {
    cookieName: "__Host-lydoc_session",
    csrfCookieName: "__Host-lydoc_csrf",
    async revokeSession(sessionId, userId) {
      calls.push(["one", sessionId, userId]);
    },
    async revokeAllSessions(userId) {
      calls.push(["all", userId]);
    },
  };
  const controller = new IdentityController({}, {}, sessions);
  const request = {
    user: { id: "user-1", email: "user@example.com", role: "USER" },
    session: {
      id: "session-1",
      user: { id: "user-1", email: "user@example.com", role: "USER" },
    },
  };

  try {
    const response = createResponse();
    assert.deepEqual(await controller.logout(request, response), {
      loggedOut: true,
    });
    const cookies = response.headers.get("set-cookie");
    assert.equal(cookies.length, 2);
    for (const cookie of cookies) {
      assert.match(cookie, /^__Host-lydoc_(?:session|csrf)=;/);
      assert.match(cookie, /; Path=\//);
      assert.match(cookie, /; Max-Age=0;/);
      assert.match(cookie, /; Secure$/);
      assert.doesNotMatch(cookie, /Domain=/i);
    }

    assert.deepEqual(await controller.logoutAll(request, createResponse()), {
      loggedOut: true,
    });
    assert.deepEqual(calls, [
      ["one", "session-1", "user-1"],
      ["all", "user-1"],
    ]);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }
});

test("public registration creates only a pending account with an unusable random password", async () => {
  let registrationInput;
  let issuedForEmail;
  let budgetInput;
  const users = {
    async createPendingRegistration(input) {
      registrationInput = input;
      return {
        id: "new-user",
        email: input.email,
        passwordHash: input.passwordHash,
        role: "USER",
        createdAt: new Date(),
      };
    },
  };
  const passwordHasher = {
    createUnusableHash() {
      return "unusable-random-password-hash";
    },
  };
  const sessions = {
    async createSession() {
      assert.fail("registration must not create a session");
    },
  };
  const identityTokens = {
    async requestRegistrationVerification(email) {
      issuedForEmail = email;
      return {};
    },
  };
  const budgets = {
    async consume(action, identifier) {
      budgetInput = { action, identifier };
    },
  };
  const controller = new IdentityController(
    users,
    passwordHasher,
    sessions,
    identityTokens,
    {},
    budgets,
  );
  const result = await controller.register({
    email: " NEW@EXAMPLE.COM ",
    password: "attacker-chosen-password",
    consentAccepted: true,
    consentVersion: CURRENT_LEGAL_CONSENT_VERSION,
    role: "ADMIN",
  });

  assert.equal(registrationInput.email, "new@example.com");
  assert.equal(registrationInput.passwordHash, "unusable-random-password-hash");
  assert.deepEqual(Object.keys(registrationInput).sort(), [
    "email",
    "passwordHash",
  ]);
  assert.equal(Object.hasOwn(registrationInput, "role"), false);
  assert.notEqual(registrationInput.passwordHash, "attacker-chosen-password");
  assert.equal(issuedForEmail, "new@example.com");
  assert.deepEqual(budgetInput, {
    action: "REGISTER",
    identifier: "new@example.com",
  });
  assert.deepEqual(result, {
    accepted: true,
    message: "Si cette adresse peut etre utilisee, un e-mail sera envoye.",
  });
});

test("registration rejects missing or stale legal consent", async () => {
  const controller = new IdentityController({}, {}, {});
  const expectedMessage =
    "Vous devez accepter les conditions et la politique applicables.";

  await assertRejectedWithStatus(
    controller.register(
      {
        email: "new@example.com",
        password: "long-enough-password",
        consentAccepted: false,
        consentVersion: CURRENT_LEGAL_CONSENT_VERSION,
      },
      createResponse(),
    ),
    400,
    expectedMessage,
  );
  await assertRejectedWithStatus(
    controller.register(
      {
        email: "new@example.com",
        password: "long-enough-password",
        consentAccepted: true,
        consentVersion: "stale-version",
      },
      createResponse(),
    ),
    400,
    expectedMessage,
  );
});

test("unknown and malformed login identifiers still execute password verification", async () => {
  const verifyCalls = [];
  const controller = new IdentityController(
    {
      async findForAuthentication() {
        return null;
      },
    },
    {
      async verifyWithDummy(password, passwordHash) {
        verifyCalls.push({ password, passwordHash });
        return false;
      },
    },
    {},
    {},
  );
  const expectedMessage = "Identifiants invalides.";

  await assertRejectedWithStatus(
    controller.login(
      { email: "absent@example.com", password: "some-password" },
      createResponse(),
    ),
    401,
    expectedMessage,
  );
  await assertRejectedWithStatus(
    controller.login(
      { email: "not-an-email", password: "some-password" },
      createResponse(),
    ),
    401,
    expectedMessage,
  );

  assert.deepEqual(verifyCalls, [
    { password: "some-password", passwordHash: undefined },
    { password: "some-password", passwordHash: undefined },
  ]);
});

test("login rejects a correct password until the e-mail is verified", async () => {
  const controller = new IdentityController(
    {
      async findForAuthentication() {
        return {
          id: "pending-user",
          email: "pending@example.com",
          passwordHash: "pending-random-hash",
          role: "USER",
          createdAt: new Date(),
          emailVerifiedAt: null,
        };
      },
    },
    {
      async verifyWithDummy() {
        return true;
      },
    },
    {
      async createSession() {
        assert.fail("no session before verification");
      },
    },
    {},
  );

  await assertRejectedWithStatus(
    controller.login(
      { email: "pending@example.com", password: "correct-password" },
      createResponse(),
    ),
    403,
    "Adresse e-mail non verifiee.",
  );
});

test("e-mail verification replaces the pending password and consent atomically", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExposure = process.env.AUTH_EXPOSE_TEST_TOKENS;
  process.env.NODE_ENV = "test";
  process.env.AUTH_EXPOSE_TEST_TOKENS = "true";
  try {
    const harness = createIdentityPrismaHarness();
    const passwordHasher = new NodePasswordHasher();
    const attackerHash = await passwordHasher.hash("attacker-password");
    harness.users.set("pending-user", {
      id: "pending-user",
      email: "victim@example.com",
      passwordHash: attackerHash,
      role: "USER",
      emailVerifiedAt: null,
      consentVersion: null,
      consentedAt: null,
      createdAt: new Date(),
    });
    const deliveries = [];
    const dependencies = createIdentityTokenDependencies(deliveries);
    const tokens = new IdentityTokenService(
      harness.prisma,
      passwordHasher,
      dependencies.outbox,
      dependencies.budgets,
    );

    const issued = await tokens.issueEmailVerification("pending-user");
    assert.match(issued.testOnlyToken, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(deliveries.length, 1);
    const [storedToken] = harness.tokens.values();
    assert.match(storedToken.tokenHash, /^[a-f0-9]{64}$/);
    assert.notEqual(storedToken.tokenHash, issued.testOnlyToken);

    const consentedAt = new Date();
    const verified = await tokens.verifyEmail(
      issued.testOnlyToken,
      "victim-owned-password",
      CURRENT_LEGAL_CONSENT_VERSION,
      consentedAt,
    );
    const user = harness.users.get("pending-user");
    assert.deepEqual(verified, {
      id: "pending-user",
      email: "victim@example.com",
      role: "USER",
    });
    assert.ok(user.emailVerifiedAt instanceof Date);
    assert.equal(user.consentVersion, CURRENT_LEGAL_CONSENT_VERSION);
    assert.equal(user.consentedAt, consentedAt);
    assert.equal(
      await passwordHasher.verify("attacker-password", user.passwordHash),
      false,
    );
    assert.equal(
      await passwordHasher.verify("victim-owned-password", user.passwordHash),
      true,
    );
    assert.ok(storedToken.usedAt instanceof Date);
    assert.ok(
      harness.audits.some((audit) => audit.action === "EMAIL_VERIFIED"),
    );
    assert.ok(
      harness.audits.some((audit) => audit.action === "LEGAL_CONSENT_RECORDED"),
    );

    await assert.rejects(
      () =>
        tokens.verifyEmail(
          issued.testOnlyToken,
          "another-password",
          CURRENT_LEGAL_CONSENT_VERSION,
          new Date(),
        ),
      InvalidIdentityTokenError,
    );
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("AUTH_EXPOSE_TEST_TOKENS", previousExposure);
  }
});

test("identity tokens expire without activating the pending account", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExposure = process.env.AUTH_EXPOSE_TEST_TOKENS;
  process.env.NODE_ENV = "test";
  process.env.AUTH_EXPOSE_TEST_TOKENS = "true";
  try {
    const harness = createIdentityPrismaHarness();
    harness.users.set("pending-user", {
      id: "pending-user",
      email: "pending@example.com",
      passwordHash: "pending-hash",
      role: "USER",
      emailVerifiedAt: null,
      consentVersion: null,
      consentedAt: null,
      createdAt: new Date(),
    });
    const tokens = new IdentityTokenService(
      harness.prisma,
      {
        async hash(value) {
          return `hash:${value}`;
        },
      },
      createIdentityTokenDependencies().outbox,
      createIdentityTokenDependencies().budgets,
    );
    const issued = await tokens.issueEmailVerification("pending-user");
    const [storedToken] = harness.tokens.values();
    storedToken.expiresAt = new Date(Date.now() - 1);

    await assert.rejects(
      () =>
        tokens.verifyEmail(
          issued.testOnlyToken,
          "victim-owned-password",
          CURRENT_LEGAL_CONSENT_VERSION,
          new Date(),
        ),
      InvalidIdentityTokenError,
    );
    assert.equal(harness.users.get("pending-user").emailVerifiedAt, null);
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("AUTH_EXPOSE_TEST_TOKENS", previousExposure);
  }
});

test("password reset is single-use and revokes every database session", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExposure = process.env.AUTH_EXPOSE_TEST_TOKENS;
  process.env.NODE_ENV = "test";
  process.env.AUTH_EXPOSE_TEST_TOKENS = "true";
  try {
    const harness = createIdentityPrismaHarness();
    const passwordHasher = new NodePasswordHasher();
    harness.users.set("user-1", {
      id: "user-1",
      email: "user@example.com",
      passwordHash: await passwordHasher.hash("old-password-value"),
      role: "USER",
      emailVerifiedAt: new Date(),
      consentVersion: CURRENT_LEGAL_CONSENT_VERSION,
      consentedAt: new Date(),
      createdAt: new Date(),
    });
    harness.sessions.set("session-1", {
      id: "session-1",
      userId: "user-1",
      revokedAt: null,
    });
    harness.sessions.set("session-2", {
      id: "session-2",
      userId: "user-1",
      revokedAt: null,
    });
    const dependencies = createIdentityTokenDependencies();
    const tokens = new IdentityTokenService(
      harness.prisma,
      passwordHasher,
      dependencies.outbox,
      dependencies.budgets,
    );

    const issued = await tokens.requestPasswordReset("user@example.com");
    await tokens.resetPassword(issued.testOnlyToken, "new-password-value");
    const user = harness.users.get("user-1");
    assert.equal(
      await passwordHasher.verify("old-password-value", user.passwordHash),
      false,
    );
    assert.equal(
      await passwordHasher.verify("new-password-value", user.passwordHash),
      true,
    );
    assert.ok(
      Array.from(harness.sessions.values()).every(
        (session) => session.revokedAt,
      ),
    );
    await assert.rejects(
      () => tokens.resetPassword(issued.testOnlyToken, "third-password-value"),
      InvalidIdentityTokenError,
    );
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("AUTH_EXPOSE_TEST_TOKENS", previousExposure);
  }
});

test("authenticated password change verifies the old password and revokes only other sessions", async () => {
  const harness = createIdentityPrismaHarness();
  const passwordHasher = new NodePasswordHasher();
  harness.users.set("user-1", {
    id: "user-1",
    email: "user@example.com",
    passwordHash: await passwordHasher.hash("current-password"),
    role: "USER",
    emailVerifiedAt: new Date(),
    consentVersion: CURRENT_LEGAL_CONSENT_VERSION,
    consentedAt: new Date(),
    createdAt: new Date(),
  });
  harness.sessions.set("current-session", {
    id: "current-session",
    userId: "user-1",
    revokedAt: null,
  });
  harness.sessions.set("other-session", {
    id: "other-session",
    userId: "user-1",
    revokedAt: null,
  });
  const dependencies = createIdentityTokenDependencies();
  const tokens = new IdentityTokenService(
    harness.prisma,
    passwordHasher,
    dependencies.outbox,
    dependencies.budgets,
  );

  await assert.rejects(
    () =>
      tokens.changePassword({
        userId: "user-1",
        currentSessionId: "current-session",
        currentPassword: "wrong-password",
        newPassword: "new-password-value",
      }),
    InvalidCurrentPasswordError,
  );
  await tokens.changePassword({
    userId: "user-1",
    currentSessionId: "current-session",
    currentPassword: "current-password",
    newPassword: "new-password-value",
  });

  assert.equal(harness.sessions.get("current-session").revokedAt, null);
  assert.ok(harness.sessions.get("other-session").revokedAt instanceof Date);
  assert.equal(
    await passwordHasher.verify(
      "new-password-value",
      harness.users.get("user-1").passwordHash,
    ),
    true,
  );
});

test("generic resend and forgot-password responses never expose production tokens", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousExposure = process.env.AUTH_EXPOSE_TEST_TOKENS;
  process.env.NODE_ENV = "production";
  process.env.AUTH_EXPOSE_TEST_TOKENS = "true";
  try {
    const identityTokens = {
      async requestEmailVerification() {
        return { testOnlyToken: "secret" };
      },
      async requestPasswordReset() {
        return { testOnlyToken: "secret" };
      },
    };
    const controller = new IdentityController({}, {}, {}, identityTokens);
    const resend = await controller.resendVerification({
      email: "known@example.com",
    });
    const forgot = await controller.forgotPassword({
      email: "known@example.com",
    });

    assert.deepEqual(resend, {
      accepted: true,
      message: "Si cette adresse peut etre utilisee, un e-mail sera envoye.",
    });
    assert.deepEqual(forgot, resend);
    assert.equal(JSON.stringify({ resend, forgot }).includes("secret"), false);
  } finally {
    restoreEnvironment("NODE_ENV", previousNodeEnv);
    restoreEnvironment("AUTH_EXPOSE_TEST_TOKENS", previousExposure);
  }
});

test("production identity e-mail uses Resend timeout and stable idempotency", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.RESEND_FROM_EMAIL,
    appUrl: process.env.APP_URL,
    fetch: global.fetch,
  };
  process.env.NODE_ENV = "production";
  process.env.RESEND_API_KEY = "re_test_identity_key";
  process.env.RESEND_FROM_EMAIL = "Lydoc <auth@example.com>";
  process.env.APP_URL = "https://app.example.com";
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ id: "resend-email-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const emails = new IdentityEmailService();
    const providerId = await emails.send({
      email: "user@example.com",
      purpose: "EMAIL_VERIFICATION",
      rawToken: "A".repeat(43),
      tokenId: "identity-token-1",
      expiresAt: new Date("2026-08-04T20:00:00.000Z"),
    });
    const payload = JSON.parse(request.options.body);

    assert.equal(providerId, "resend-email-1");
    assert.equal(request.url, "https://api.resend.com/emails");
    assert.equal(
      request.options.headers["Idempotency-Key"],
      "lydoc-email_verification-identity-token-1",
    );
    assert.ok(request.options.signal instanceof AbortSignal);
    assert.match(
      payload.text,
      /https:\/\/app\.example\.com\/verification-email#token=/,
    );
    assert.equal(payload.to[0], "user@example.com");
  } finally {
    global.fetch = previous.fetch;
    restoreEnvironment("NODE_ENV", previous.nodeEnv);
    restoreEnvironment("RESEND_API_KEY", previous.apiKey);
    restoreEnvironment("RESEND_FROM_EMAIL", previous.from);
    restoreEnvironment("APP_URL", previous.appUrl);
  }
});

test("the real password hasher has a valid constant-work dummy path", async () => {
  const passwordHasher = new NodePasswordHasher();
  assert.equal(await passwordHasher.verifyWithDummy("guess", undefined), false);
});

test("normalizes case, duplicate slashes, trailing slashes and encoded separators", () => {
  assert.equal(normalizeRequestPath("/AUTH//LOGIN/"), "/auth/login");
  assert.equal(normalizeRequestPath("%2Fauth%2Fregister%2F"), "/auth/register");
});

test("IP rate limiting cannot be bypassed with path case or slash variants", () => {
  let now = 1_000;
  const limiter = createRateLimiter(2, 60_000, () => now);
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  limiter(createRequest({ path: "/AUTH/LOGIN/" }), createResponse(), next);
  limiter(createRequest({ path: "/auth//login" }), createResponse(), next);
  const blockedResponse = createResponse();
  limiter(createRequest({ path: "/auth/login" }), blockedResponse, next);

  assert.equal(nextCalls, 2);
  assert.equal(blockedResponse.statusCode, 429);
  assert.equal(blockedResponse.headers.get("retry-after"), 60);

  now += 60_001;
  limiter(createRequest({ path: "/auth/login" }), createResponse(), next);
  assert.equal(nextCalls, 3);
});

test("identifier rate limiting follows normalized email across source IPs", () => {
  const limiter = createIdentifierRateLimiter(1, 60_000, () => 1_000);
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  limiter(
    createRequest({
      path: "/AUTH/LOGIN/",
      ip: "203.0.113.10",
      body: { email: " Victim@Example.com " },
    }),
    createResponse(),
    next,
  );
  const blockedResponse = createResponse();
  limiter(
    createRequest({
      path: "/auth/login",
      ip: "198.51.100.20",
      body: { email: "victim@example.com" },
    }),
    blockedResponse,
    next,
  );

  assert.equal(nextCalls, 1);
  assert.equal(blockedResponse.statusCode, 429);
});

test("recovery and verification endpoints are covered by existing rate limits", () => {
  const identifierLimiter = createIdentifierRateLimiter(1, 60_000, () => 1_000);
  const ipLimiter = createRateLimiter(1, 60_000, () => 1_000);
  const next = () => {};

  identifierLimiter(
    createRequest({
      path: "/AUTH/FORGOT-PASSWORD/",
      body: { email: "user@example.com" },
    }),
    createResponse(),
    next,
  );
  const identifierBlocked = createResponse();
  identifierLimiter(
    createRequest({
      path: "/auth/forgot-password",
      ip: "198.51.100.20",
      body: { email: " USER@example.com " },
    }),
    identifierBlocked,
    next,
  );

  ipLimiter(
    createRequest({ path: "/AUTH/RESET-PASSWORD/" }),
    createResponse(),
    next,
  );
  const ipBlocked = createResponse();
  ipLimiter(createRequest({ path: "/auth//reset-password" }), ipBlocked, next);

  assert.equal(identifierBlocked.statusCode, 429);
  assert.equal(ipBlocked.statusCode, 429);
});

test("CSRF protection requires a trusted source and double-submit token", () => {
  const protect = createCsrfProtection(
    ["https://app.example.com"],
    csrfOptions,
  );
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  protect(
    createRequest({
      path: "/auth/logout",
      headers: {
        origin: "https://app.example.com",
        cookie: "lydoc_csrf=valid-token",
        "x-csrf-token": "valid-token",
      },
    }),
    createResponse(),
    next,
  );
  protect(
    createRequest({
      path: "/profile",
      headers: {
        referer: "https://app.example.com/settings",
        cookie: "lydoc_csrf=valid-token",
        "x-csrf-token": "valid-token",
      },
    }),
    createResponse(),
    next,
  );

  const missingOrigin = createResponse();
  protect(
    createRequest({
      path: "/auth/logout",
      headers: {
        cookie: "lydoc_csrf=valid-token",
        "x-csrf-token": "valid-token",
      },
    }),
    missingOrigin,
    next,
  );
  const crossSite = createResponse();
  protect(
    createRequest({
      path: "/auth/logout",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "cross-site",
        cookie: "lydoc_csrf=valid-token",
        "x-csrf-token": "valid-token",
      },
    }),
    crossSite,
    next,
  );
  const missingToken = createResponse();
  protect(
    createRequest({
      path: "/auth/logout",
      headers: { origin: "https://app.example.com" },
    }),
    missingToken,
    next,
  );
  const duplicateCookie = createResponse();
  protect(
    createRequest({
      path: "/auth/logout",
      headers: {
        origin: "https://app.example.com",
        cookie: "lydoc_csrf=valid-token; lydoc_csrf=valid-token",
        "x-csrf-token": "valid-token",
      },
    }),
    duplicateCookie,
    next,
  );

  assert.equal(nextCalls, 2);
  assert.equal(missingOrigin.statusCode, 403);
  assert.equal(crossSite.statusCode, 403);
  assert.equal(missingToken.statusCode, 403);
  assert.equal(duplicateCookie.statusCode, 403);
});

test("CSRF protection keeps only the two raw webhook endpoints exempt", () => {
  const protect = createCsrfProtection(
    ["https://app.example.com"],
    csrfOptions,
  );
  let nextCalls = 0;
  const next = () => {
    nextCalls += 1;
  };

  protect(
    createRequest({ path: "/PAYMENTS/SUMUP/WEBHOOK/" }),
    createResponse(),
    next,
  );
  protect(
    createRequest({ path: "/shipping/service-postal/webhook" }),
    createResponse(),
    next,
  );
  const nonWebhook = createResponse();
  protect(
    createRequest({ path: "/payments/sumup/checkout" }),
    nonWebhook,
    next,
  );

  assert.equal(nextCalls, 2);
  assert.equal(nonWebhook.statusCode, 403);
});

test("JSON bodies stay small and raw bytes are copied only for signed webhooks", async (t) => {
  const app = express();
  app.use(createDefaultJsonBodyParser());
  app.post("/shipping/service-postal/webhook", (request, response) => {
    response.json({ rawBytes: request.rawBody?.length ?? 0 });
  });
  app.post("/auth/login", (request, response) => {
    response.json({ rawBodyCopied: Boolean(request.rawBody) });
  });
  app.post("/documents", (_request, response) => {
    response.json({ accepted: true });
  });
  app.use((error, _request, response, _next) => {
    response.status(error.status ?? 500).json({ message: error.message });
  });

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, "object");
  const payload = JSON.stringify({ content: "a".repeat(1_100_000) });
  const request = (path) =>
    fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });

  const documentResponse = await request("/documents");
  assert.equal(documentResponse.status, 413);

  const authResponse = await request("/auth/login");
  assert.equal(authResponse.status, 413);

  const webhookResponse = await fetch(
    `http://127.0.0.1:${address.port}/shipping/service-postal/webhook`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: "test" }),
    },
  );
  assert.equal(webhookResponse.status, 200);
  assert.ok((await webhookResponse.json()).rawBytes > 0);

  const smallAuthResponse = await fetch(
    `http://127.0.0.1:${address.port}/auth/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    },
  );
  assert.deepEqual(await smallAuthResponse.json(), { rawBodyCopied: false });
});

test("proxy trust requires an explicit bounded IP or CIDR allowlist", () => {
  assert.equal(parseTrustedProxyCidrs(false, undefined), false);
  assert.deepEqual(
    parseTrustedProxyCidrs(true, "10.20.0.10, 2001:db8::1/128"),
    ["10.20.0.10", "2001:db8::1/128"],
  );
  assert.throws(() => parseTrustedProxyCidrs(true, undefined));
  assert.throws(() => parseTrustedProxyCidrs(true, "0.0.0.0/0"));
  assert.throws(() => parseTrustedProxyCidrs(true, "::/0"));
  assert.throws(() => parseTrustedProxyCidrs(true, "not-an-ip"));
});
