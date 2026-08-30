const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.SESSION_SECRET =
  "test-session-secret-with-at-least-thirty-two-characters";

const {
  IdentityEmailOutboxService,
  decryptOutboxToken,
  encryptOutboxToken,
} = require("../dist/modules/identity/identity-email-outbox.service.js");
const {
  IdentityEmailDeliveryError,
} = require("../dist/modules/identity/identity-email.service.js");
const {
  AdminMfaService,
  InvalidAdminMfaError,
} = require("../dist/modules/identity/admin-mfa.service.js");
const {
  AuthBudgetExceededError,
  PersistentAuthBudgetService,
} = require("../dist/modules/identity/persistent-auth-budget.service.js");
const {
  accountErasureBlockReason,
  AccountDataRightsService,
  legalRetentionPlan,
  redactPersonalJson,
} = require("../dist/modules/identity/account-data-rights.service.js");
const {
  AdminInvoicesController,
} = require("../dist/modules/documents/admin-invoices.controller.js");

test("identity outbox token encryption is authenticated and bound to user/token IDs", () => {
  const secret = "dedicated-outbox-secret-with-at-least-thirty-two-characters";
  const rawToken = "A".repeat(43);
  const envelope = encryptOutboxToken(rawToken, "user-1", "token-1", secret);

  assert.doesNotMatch(envelope, new RegExp(rawToken));
  assert.equal(
    decryptOutboxToken(envelope, "user-1", "token-1", secret),
    rawToken,
  );
  assert.throws(() =>
    decryptOutboxToken(envelope, "user-2", "token-1", secret),
  );
  const replacement = envelope.endsWith("A") ? "B" : "A";
  assert.throws(() =>
    decryptOutboxToken(
      `${envelope.slice(0, -1)}${replacement}`,
      "user-1",
      "token-1",
      secret,
    ),
  );
});

test("identity outbox retries transient failures then dead-letters at the configured cap", async () => {
  const previousAttempts = process.env.IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS;
  process.env.IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS = "2";
  const rawToken = "B".repeat(43);
  const state = {
    id: "outbox-1",
    userId: "user-1",
    tokenId: "token-1",
    rawTokenEncrypted: encryptOutboxToken(
      rawToken,
      "user-1",
      "token-1",
      process.env.SESSION_SECRET,
    ),
    attempts: 0,
    availableAt: new Date(),
    lockedAt: null,
    lockId: null,
    sentAt: null,
    deadLetteredAt: null,
    failureCode: null,
    providerMessageId: null,
    createdAt: new Date(),
  };
  const audits = [];
  const transaction = {
    async $queryRaw() {
      return !state.sentAt &&
        !state.deadLetteredAt &&
        state.attempts < Number(process.env.IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS)
        ? [{ id: state.id }]
        : [];
    },
    identityEmailOutbox: {
      async updateMany({ where, data }) {
        if (where.id?.in && !where.id.in.includes(state.id))
          return { count: 0 };
        if (typeof where.id === "string" && where.id !== state.id) {
          return { count: 0 };
        }
        if (where.lockId !== undefined && where.lockId !== state.lockId) {
          return { count: 0 };
        }
        if (data.attempts?.increment) state.attempts += data.attempts.increment;
        for (const [key, value] of Object.entries(data)) {
          if (key !== "attempts") state[key] = value;
        }
        return { count: 1 };
      },
      async findMany({ where }) {
        if (where.lockId !== state.lockId) return [];
        return [
          {
            ...state,
            user: { email: "user@example.com", accountDeletedAt: null },
            token: {
              purpose: "EMAIL_VERIFICATION",
              expiresAt: new Date("2026-08-11T00:00:00.000Z"),
              usedAt: null,
            },
          },
        ];
      },
    },
    auditLog: {
      async create({ data }) {
        audits.push(data);
        return data;
      },
    },
  };
  const prisma = {
    async $transaction(operation) {
      return operation(transaction);
    },
  };
  let providerCalls = 0;
  const worker = new IdentityEmailOutboxService(prisma, {
    async send(input) {
      providerCalls += 1;
      assert.equal(input.rawToken, rawToken);
      throw new IdentityEmailDeliveryError("PROVIDER_HTTP_503", true);
    },
  });

  try {
    const first = await worker.runOnce(new Date("2026-08-10T10:00:00.000Z"));
    assert.deepEqual(first, {
      claimed: 1,
      sent: 0,
      retried: 1,
      deadLettered: 0,
    });
    assert.equal(state.attempts, 1);
    assert.equal(state.lockId, null);
    assert.equal(state.deadLetteredAt, null);

    const second = await worker.runOnce(new Date("2026-08-10T17:00:00.000Z"));
    assert.deepEqual(second, {
      claimed: 1,
      sent: 0,
      retried: 0,
      deadLettered: 1,
    });
    assert.equal(providerCalls, 2);
    assert.equal(state.attempts, 2);
    assert.ok(state.deadLetteredAt instanceof Date);
    assert.equal(state.failureCode, "PROVIDER_HTTP_503");
    assert.equal(
      audits.filter((audit) => audit.action === "IDENTITY_EMAIL_DEAD_LETTERED")
        .length,
      1,
    );
  } finally {
    restoreEnvironment("IDENTITY_EMAIL_OUTBOX_MAX_ATTEMPTS", previousAttempts);
  }
});

test("concurrent invalid MFA submissions consume exactly five attempts and lock once", async () => {
  const challenge = {
    id: "challenge-1",
    userId: "admin-1",
    purpose: "ADMIN_MFA_LOGIN",
    tokenHash: "ignored",
    attempts: 0,
    usedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    user: {
      id: "admin-1",
      email: "admin@example.com",
      role: "ADMIN",
      emailVerifiedAt: new Date(),
      accountDeletedAt: null,
      mfaEnabledAt: new Date(),
      mfaSecretEncrypted: "encrypted-secret",
      mfaLastUsedStep: null,
    },
  };
  const audits = [];
  const transaction = {
    identityToken: {
      async updateMany({ where, data }) {
        if (where.id !== challenge.id) return { count: 0 };
        if (where.usedAt === null && challenge.usedAt !== null)
          return { count: 0 };
        if (where.expiresAt?.gt && challenge.expiresAt <= where.expiresAt.gt) {
          return { count: 0 };
        }
        if (
          where.attempts?.lt !== undefined &&
          challenge.attempts >= where.attempts.lt
        ) {
          return { count: 0 };
        }
        if (
          where.attempts?.gte !== undefined &&
          challenge.attempts < where.attempts.gte
        ) {
          return { count: 0 };
        }
        if (data.attempts?.increment)
          challenge.attempts += data.attempts.increment;
        if (data.usedAt) challenge.usedAt = data.usedAt;
        return { count: 1 };
      },
    },
    auditLog: {
      async create({ data }) {
        audits.push(data);
        return data;
      },
    },
  };
  const prisma = {
    identityToken: {
      async findUnique() {
        return {
          ...challenge,
          user: { ...challenge.user },
          usedAt: null,
          attempts: 0,
        };
      },
    },
    async $transaction(operation) {
      return operation(transaction);
    },
  };
  const mfa = new AdminMfaService(
    prisma,
    {
      decrypt() {
        return "JBSWY3DPEHPK3PXP";
      },
    },
    { async consume() {} },
  );

  const results = await Promise.allSettled(
    Array.from({ length: 20 }, () =>
      mfa.verifyLoginChallenge("C".repeat(43), "invalid"),
    ),
  );
  assert.ok(
    results.every(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof InvalidAdminMfaError,
    ),
  );
  assert.equal(challenge.attempts, 5);
  assert.ok(challenge.usedAt instanceof Date);
  assert.equal(
    audits.filter((audit) => audit.action === "ADMIN_MFA_CHALLENGE_LOCKED")
      .length,
    1,
  );
});

test("persistent auth budgets hash identifiers and enforce a distributed per-identifier cap", async () => {
  const buckets = new Map();
  const transaction = {
    authBudgetBucket: {
      async upsert({ where, create, update }) {
        const current = buckets.get(where.key);
        buckets.set(
          where.key,
          current ? { ...current, ...update } : { ...create },
        );
      },
      async updateMany({ where, data }) {
        const current = buckets.get(where.key);
        if (!current || current.count >= where.count.lt) return { count: 0 };
        current.count += data.count.increment;
        return { count: 1 };
      },
    },
  };
  const budgets = new PersistentAuthBudgetService({
    async $transaction(operation) {
      return operation(transaction);
    },
  });
  const now = new Date("2026-08-10T10:30:00.000Z");

  for (let index = 0; index < 5; index += 1) {
    await budgets.consume("FORGOT_PASSWORD", "victim@example.com", now);
  }
  await assert.rejects(
    () => budgets.consume("FORGOT_PASSWORD", "victim@example.com", now),
    AuthBudgetExceededError,
  );
  await budgets.consume("FORGOT_PASSWORD", "other@example.com", now);
  assert.equal(
    Array.from(buckets.keys()).some((key) =>
      key.includes("victim@example.com"),
    ),
    false,
  );
  assert.ok(Array.from(buckets.keys()).every((key) => key.length <= 96));
});

test("account erasure revokes authentication, deletes derived data and preserves ledger counts", async () => {
  const user = {
    id: "user-1",
    email: "user@example.com",
    passwordHash: "hash:correct-password",
    role: "USER",
    accountDeletedAt: null,
    firstName: "Alice",
    lastName: "Example",
    postalAddress: "1 rue Exemple",
    emailVerifiedAt: new Date(),
    cases: [
      {
        id: "case-1",
        complianceSnapshotJson: {
          evidence: "Alice Example invoice",
          detectedSmsCharges: [{ label: "Alice SMS", amountCents: 500 }],
        },
        validationSnapshotJson: {
          customer: { email: "user@example.com", firstName: "Alice" },
          estimatedRecoverableCents: 500,
        },
      },
      {
        id: "case-legal",
        complianceSnapshotJson: { evidence: "Alice paid invoice" },
        validationSnapshotJson: { amountCents: 900 },
      },
    ],
    documents: [{ id: "doc-1", caseDocuments: [] }],
  };
  const calls = [];
  const legalPacketCreatedAt = new Date();
  const historicalAudit = {
    id: "audit-1",
    metadata: {
      ownerId: "user-1",
      originalName: "facture-Alice.pdf",
      legalBasis: "PAYMENT_LEDGER",
    },
  };
  const transaction = {
    async $executeRaw() {
      return 1;
    },
    async $queryRaw() {
      return [{ id: user.id }];
    },
    user: {
      async findUnique() {
        return structuredClone(user);
      },
      async updateMany({ data }) {
        Object.assign(user, data);
        return { count: 1 };
      },
    },
    payment: {
      async count() {
        return 1;
      },
    },
    generatedPacket: {
      async findMany() {
        return [
          {
            id: "packet-1",
            caseId: "case-1",
            storageBucket: "generated-packets",
            storageKey: "packet-1.enc",
            checksumSha256: "a".repeat(64),
            sizeBytes: 1_024,
            purgeRequestedAt: null,
            createdAt: new Date("2026-08-09T00:00:00.000Z"),
            case: {
              status: "GENERATED",
              payment: null,
              postalShipment: null,
              _count: { generatedPackets: 1 },
            },
          },
          {
            id: "packet-legal",
            caseId: "case-legal",
            storageBucket: "generated-packets",
            storageKey: "packet-legal.enc",
            checksumSha256: "b".repeat(64),
            sizeBytes: 2_048,
            purgeRequestedAt: null,
            createdAt: legalPacketCreatedAt,
            case: {
              status: "PAID",
              payment: { status: "PAID" },
              postalShipment: null,
              _count: { generatedPackets: 1 },
            },
          },
        ];
      },
      async updateMany() {
        calls.push("packet-tombstoned");
        return { count: 1 };
      },
    },
    storagePurgeJob: {
      async upsert() {
        calls.push("packet-purge-job");
        return { id: "purge-job-1" };
      },
    },
    postalShipment: {
      async count() {
        return 1;
      },
      async updateMany() {
        calls.push("postal-redacted");
        return { count: 1 };
      },
    },
    administrativeCase: {
      async findMany() {
        return user.cases.map(({ id }) => ({ id }));
      },
      async update({ data }) {
        calls.push({ caseData: data });
        return data;
      },
    },
    ocrResult: {
      async deleteMany() {
        calls.push("ocr-deleted");
        return { count: 1 };
      },
    },
    documentAnalysis: {
      async deleteMany() {
        calls.push("analysis-deleted");
        return { count: 1 };
      },
    },
    document: {
      async findMany() {
        return user.documents.map(({ id }) => ({ id }));
      },
      async updateMany() {
        calls.push("filenames-redacted");
        return { count: 1 };
      },
    },
    notificationDelivery: {
      async updateMany() {
        calls.push("notifications-redacted");
        return { count: 1 };
      },
    },
    userSession: {
      async deleteMany() {
        calls.push("sessions-deleted");
        return { count: 2 };
      },
    },
    identityToken: {
      async deleteMany() {
        calls.push("tokens-deleted");
        return { count: 2 };
      },
    },
    documentUploadReservation: {
      async deleteMany() {
        calls.push("reservations-deleted");
        return { count: 0 };
      },
    },
    auditLog: {
      async findMany() {
        return [structuredClone(historicalAudit)];
      },
      async update({ data }) {
        historicalAudit.metadata = data.metadata;
        calls.push("audit-metadata-redacted");
        return historicalAudit;
      },
      async create({ data }) {
        calls.push({ audit: data });
        return data;
      },
    },
  };
  const service = new AccountDataRightsService(
    {
      user: {
        async findUnique() {
          return {
            id: user.id,
            passwordHash: user.passwordHash,
            role: user.role,
            accountDeletedAt: user.accountDeletedAt,
          };
        },
      },
      async $transaction(operation) {
        return operation(transaction);
      },
    },
    {
      async verifyWithDummy(password, hash) {
        return hash === `hash:${password}`;
      },
      createUnusableHash() {
        return "unusable-deleted-account-hash";
      },
    },
  );

  const result = await service.deleteAccount({
    userId: "user-1",
    currentPassword: "correct-password",
  });
  assert.equal(result.deleted, true);
  assert.deepEqual(result.retainedLedgerCounts, {
    documents: 1,
    cases: 2,
    payments: 1,
    generatedPackets: 2,
    postalShipments: 1,
  });
  assert.equal(result.documentPurgeSchedule.gracePeriod, 1);
  assert.equal(result.documentPurgeSchedule.legalRetention, 0);
  assert.deepEqual(result.packetPurgeSchedule, {
    immediate: 1,
    policyRetention: 1,
    retained: [
      {
        packetId: "packet-legal",
        basis: "PAID_OR_REFUNDED_TRANSACTION",
        purgeAfter: new Date(
          legalPacketCreatedAt.getTime() + 30 * 24 * 60 * 60 * 1_000,
        ).toISOString(),
      },
    ],
  });
  assert.match(user.email, /^deleted-[a-f0-9]{40}@deleted\.invalid$/);
  assert.equal(user.firstName, null);
  assert.equal(user.emailVerifiedAt, null);
  assert.ok(user.accountDeletedAt instanceof Date);
  assert.ok(calls.includes("sessions-deleted"));
  assert.ok(calls.includes("tokens-deleted"));
  assert.ok(calls.includes("ocr-deleted"));
  assert.ok(calls.includes("packet-tombstoned"));
  assert.ok(calls.includes("packet-purge-job"));
  assert.ok(calls.includes("audit-metadata-redacted"));
  assert.deepEqual(historicalAudit.metadata, {
    ownerId: "",
    originalName: "",
    legalBasis: "PAYMENT_LEDGER",
  });
  const caseUpdate = calls.find((call) => call.caseData)?.caseData;
  assert.equal(caseUpdate.validationSnapshotJson.customer.email, "");
  assert.equal(caseUpdate.complianceSnapshotJson.evidence, "");
  assert.ok(
    calls.some(
      (call) =>
        call.audit?.action ===
        "ACCOUNT_ERASURE_PSEUDONYMIZED_AND_PURGE_SCHEDULED",
    ),
  );
});

test("a free self-service packet does not create ten-year document retention", () => {
  const {
    requiresLegalDocumentRetention,
  } = require("../dist/modules/identity/account-data-rights.service.js");
  assert.equal(
    requiresLegalDocumentRetention({
      status: "GENERATED",
      payment: null,
      postalShipment: null,
      _count: { generatedPackets: 1 },
    }),
    false,
  );
  assert.equal(
    requiresLegalDocumentRetention({
      status: "PAID",
      payment: { status: "PAID" },
      postalShipment: null,
      _count: { generatedPackets: 1 },
    }),
    true,
  );
  assert.equal(
    requiresLegalDocumentRetention({
      status: "PAID",
      payment: { status: "PENDING" },
      postalShipment: { status: "SUBMITTING" },
      _count: { generatedPackets: 1 },
    }),
    false,
  );
});

test("legal retention expires from the transaction event, not from account erasure", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  assert.equal(
    legalRetentionPlan(
      {
        payment: {
          status: "PAID",
          paidAt: new Date("2025-01-01T00:00:00.000Z"),
        },
        postalShipment: null,
      },
      now,
      365,
    ),
    null,
  );
  const retained = legalRetentionPlan(
    {
      payment: null,
      postalShipment: {
        status: "DELIVERED",
        submittedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    },
    now,
    365,
  );
  assert.deepEqual(retained, {
    basis: "POSTAL_FULFILLMENT",
    purgeAfter: new Date("2027-08-01T00:00:00.000Z"),
  });
});

test("account erasure waits for unresolved payment and postal side effects", () => {
  assert.equal(
    accountErasureBlockReason([
      { payment: { status: "PENDING" }, postalShipment: null },
    ]),
    "PAYMENT_PENDING",
  );
  assert.equal(
    accountErasureBlockReason([
      { payment: { status: "PAID" }, postalShipment: { status: "SUBMITTING" } },
    ]),
    "POSTAL_SUBMISSION_IN_FLIGHT",
  );
  assert.equal(
    accountErasureBlockReason([
      { payment: { status: "PAID" }, postalShipment: { status: "SUBMITTED" } },
    ]),
    null,
  );
});

test("personal JSON redaction preserves monetary ledger values", () => {
  assert.deepEqual(
    redactPersonalJson({
      customer: { email: "person@example.com", firstName: "Alice" },
      amountCents: 1234,
      evidence: "Alice invoice line",
    }),
    {
      customer: { email: "", firstName: "" },
      amountCents: 1234,
      evidence: "",
    },
  );
});

test("admin invoice access audits proof without duplicating customer PII", async () => {
  let audit;
  const controller = new AdminInvoicesController(
    {
      document: {
        async findFirst() {
          return {
            id: "document-1",
            ownerId: "user-1",
            kind: "ORANGE_INVOICE",
            originalName: "facture-Alice.pdf",
            mimeType: "application/pdf",
            sizeBytes: 8,
            storageBucket: "documents",
            storageKey: "user-1/invoice.enc",
            checksumSha256: "a".repeat(64),
          };
        },
      },
      auditLog: {
        async create({ data }) {
          audit = data;
          return data;
        },
      },
    },
    {
      async getDecryptedObject() {
        return Buffer.from("%PDF-1.7");
      },
    },
  );

  await controller.view(
    "document-1",
    { user: { id: "admin-1" } },
    { set() {} },
  );
  assert.deepEqual(audit.metadata, { kind: "ORANGE_INVOICE" });
  assert.equal(audit.metadata.ownerId, undefined);
  assert.equal(audit.metadata.originalName, undefined);
});

test("account export is bounded, cursor-paginated and omits storage locations", async () => {
  let documentQuery;
  const service = new AccountDataRightsService(
    {
      user: {
        async findFirst() {
          return { id: "user-1" };
        },
      },
      document: {
        async findMany(query) {
          documentQuery = query;
          return [
            { id: "doc-1", originalName: "one.pdf" },
            { id: "doc-2", originalName: "two.pdf" },
            { id: "doc-3", originalName: "three.pdf" },
          ];
        },
      },
    },
    {},
  );

  const page = await service.exportPage({
    userId: "user-1",
    resource: "documents",
    cursor: null,
    limit: 2,
  });
  assert.equal(page.format, "lydoc-account-export.v1");
  assert.deepEqual(
    page.items.map(({ id }) => id),
    ["doc-1", "doc-2"],
  );
  assert.equal(page.nextCursor, "doc-2");
  assert.equal(documentQuery.take, 3);
  assert.equal(documentQuery.select.storageKey, undefined);
  assert.equal(documentQuery.select.storageBucket, undefined);
});

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
