const assert = require("node:assert/strict");
const test = require("node:test");
const {
  canSendDocumentToAi,
  requireDocumentEligibleForAi,
} = require("../dist/platform/ai-document-policy.js");
const {
  isManagedPostalEnabled,
  isSensitiveDocumentWatermarkingEnabled,
  requireManagedPostalEnabled,
} = require("../dist/platform/feature-flags.js");
const {
  EligibilityService,
  caseDeletionBlockReason,
} = require("../dist/modules/eligibility/eligibility.service.js");
const {
  isUsableCaseDocument,
} = require("../dist/modules/documents/document-requirements.js");
const {
  DocumentLifecycleService,
  automaticRetentionEnabled,
  canReturnCaseToDocumentCollection,
  retentionIntervalMilliseconds,
} = require("../dist/modules/documents/document-lifecycle.service.js");

test("managed postal is disabled unless explicitly enabled", () => {
  assert.equal(isManagedPostalEnabled({}), false);
  assert.equal(
    isManagedPostalEnabled({ MANAGED_POSTAL_ENABLED: "false" }),
    false,
  );
  assert.equal(
    isManagedPostalEnabled({ MANAGED_POSTAL_ENABLED: "TRUE" }),
    true,
  );
  assert.throws(() => requireManagedPostalEnabled({}), /bientôt disponible/);
});

test("sensitive document watermarking is disabled outside production", () => {
  assert.equal(isSensitiveDocumentWatermarkingEnabled({}), false);
  assert.equal(
    isSensitiveDocumentWatermarkingEnabled({ NODE_ENV: "production" }),
    true,
  );
  assert.equal(
    isSensitiveDocumentWatermarkingEnabled({
      NODE_ENV: "development",
    }),
    false,
  );
});

test("accepts unwatermarked sensitive case documents only when watermarking is disabled", () => {
  const bankDetails = { kind: "BANK_DETAILS", watermarked: false };
  assert.equal(isUsableCaseDocument(bankDetails, true), false);
  assert.equal(isUsableCaseDocument(bankDetails, false), true);
  assert.equal(
    isUsableCaseDocument(
      { kind: "IDENTITY_DOCUMENT", watermarked: true },
      true,
    ),
    true,
  );
  assert.equal(
    isUsableCaseDocument({ kind: "ORANGE_INVOICE", watermarked: false }, true),
    true,
  );
});

test("watermark migration is a no-op when watermarking is disabled", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const service = new DocumentLifecycleService({}, {}, {}, {});
    assert.deepEqual(
      await service.migrateSensitiveDocuments({
        actorId: "admin-1",
        dryRun: true,
        limit: 25,
      }),
      { dryRun: true, disabled: true, candidates: [] },
    );
    assert.deepEqual(
      await service.migrateSensitiveDocuments({
        actorId: "admin-1",
        dryRun: false,
        limit: 25,
      }),
      { dryRun: false, disabled: true, results: [] },
    );
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test("only game rules can enter an AI flow", () => {
  assert.equal(canSendDocumentToAi("ORANGE_INVOICE"), false);
  assert.equal(canSendDocumentToAi("GAME_RULE_PDF"), true);
  assert.equal(canSendDocumentToAi("IDENTITY_DOCUMENT"), false);
  assert.equal(canSendDocumentToAi("BANK_DETAILS"), false);
  assert.throws(
    () => requireDocumentEligibleForAi("IDENTITY_DOCUMENT"),
    /ne peut pas être transmis à une IA/,
  );
});

test("requires valid customer-confirmed SMS details before creating a case", async () => {
  const service = new EligibilityService({}, {}, {});
  await assert.rejects(
    service.createCaseFromInvoice("doc-1", "user-1", "rule-1", 0, 299, true),
    /nombre de SMS/,
  );
  await assert.rejects(
    service.createCaseFromInvoice("doc-1", "user-1", "rule-1", 2, 0, true),
    /montant/,
  );
  await assert.rejects(
    service.createCaseFromInvoice("doc-1", "user-1", "rule-1", 2, 299, false),
    /Confirmez/,
  );
});

test("creates a case from customer-entered SMS details without OCR", async () => {
  let createdData;
  const rule = {
    id: "rule-1",
    version: 3,
    name: "Jeu du soir",
    reimbursementCents: 99,
    requiredDocuments: [],
    constraintsJson: {},
    validFrom: null,
    validUntil: null,
    reviewedAt: new Date("2026-09-01T00:00:00.000Z"),
    organizer: { name: "M6" },
  };
  const createdCase = {
    id: "case-1",
    status: "DRAFT",
    fulfillmentMode: null,
    estimatedRecoverableCents: 297,
    serviceFeeCents: 0,
    confidence: null,
    complianceSnapshotJson: {},
    createdAt: new Date("2026-09-12T00:00:00.000Z"),
  };
  const transaction = {
    $executeRaw: async () => 1,
    document: {
      findFirst: async () => ({ id: "doc-1" }),
      update: async () => ({ id: "doc-1" }),
    },
    gameRule: { findFirst: async () => ({ id: rule.id }) },
    caseDocument: { findFirst: async () => null },
    administrativeCase: {
      create: async ({ data }) => {
        createdData = data;
        return {
          ...createdCase,
          complianceSnapshotJson: data.complianceSnapshotJson,
        };
      },
    },
    auditLog: { create: async () => ({ id: "audit-1" }) },
  };
  const service = new EligibilityService(
    {
      document: {
        findFirst: async () => ({
          id: "doc-1",
          kind: "ORANGE_INVOICE",
          caseDocuments: [],
        }),
      },
      gameRule: { findFirst: async () => rule },
      $transaction: async (operation) => operation(transaction),
    },
    {},
    {},
  );

  const result = await service.createCaseFromInvoice(
    "doc-1",
    "user-1",
    "rule-1",
    3,
    297,
    true,
  );

  assert.equal(result.case.id, "case-1");
  assert.equal(result.document.participationCount, 3);
  assert.equal(createdData.estimatedRecoverableCents, 297);
  assert.deepEqual(createdData.complianceSnapshotJson.detectedSmsCharges, [
    {
      label: "Saisie client : 3 SMS pour 2.97 EUR",
      quantity: 3,
      amountCents: 297,
      evidence:
        "Nombre de SMS et montant confirmes par le client sur sa facture",
    },
  ]);
});

test("configures automatic retention safely", () => {
  assert.equal(automaticRetentionEnabled({ NODE_ENV: "production" }), true);
  assert.equal(
    automaticRetentionEnabled({
      NODE_ENV: "production",
      DOCUMENT_RETENTION_AUTOMATION_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    retentionIntervalMilliseconds({
      DOCUMENT_RETENTION_INTERVAL_MINUTES: "5",
    }),
    5 * 60 * 1000,
  );
  assert.equal(canReturnCaseToDocumentCollection("READY_TO_PAY"), true);
  assert.equal(canReturnCaseToDocumentCollection("PAID"), false);
});

test("purges OCR text and derived analyses as soon as document retention expires", async () => {
  const documentQueries = [
    [],
    [{ id: "doc-expired", kind: "ORANGE_INVOICE", caseDocuments: [] }],
    [],
  ];
  const auditActions = [];
  const transaction = {
    $queryRaw: async () => [{ acquired: true }],
    $executeRaw: async () => 0,
    document: {
      findMany: async () => documentQueries.shift() ?? [],
      findFirst: async () => ({
        id: "doc-expired",
        kind: "ORANGE_INVOICE",
      }),
    },
    documentStorageRevision: { findMany: async () => [] },
    generatedPacket: { findMany: async () => [] },
    storageWriteReservation: { deleteMany: async () => ({ count: 0 }) },
    ocrResult: { deleteMany: async () => ({ count: 1 }) },
    documentAnalysis: { deleteMany: async () => ({ count: 2 }) },
    auditLog: {
      create: async ({ data }) => {
        auditActions.push(data.action);
        return data;
      },
    },
  };
  const lifecycle = new DocumentLifecycleService(
    {
      $transaction: async (operation) => operation(transaction),
      storagePurgeJob: { findMany: async () => [] },
      storageWriteReservation: { findMany: async () => [] },
    },
    {},
    {},
  );
  const result = await lifecycle.runRetention({ actorId: null, dryRun: false });
  assert.deepEqual(result.derivedDataResults, [
    {
      id: "doc-expired",
      status: "PURGED",
      ocrResultCount: 1,
      analysisCount: 2,
    },
  ]);
  assert.deepEqual(auditActions, ["DOCUMENT_DERIVED_DATA_RETENTION_PURGED"]);
});

test("blocks destructive deletion once a case has financial or generated history", () => {
  assert.equal(
    caseDeletionBlockReason({
      status: "PAID",
      paymentStatus: "PAID",
      postalShipmentStatus: "SUBMITTED",
      postalProviderUid: "postal-1",
      generatedPacketCount: 1,
    }),
    "PAYMENT_PAID",
  );
  assert.equal(
    caseDeletionBlockReason({
      status: "DRAFT",
      paymentStatus: null,
      postalShipmentStatus: "DRAFT",
      postalProviderUid: null,
      generatedPacketCount: 0,
    }),
    null,
  );
});

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
