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
  aiDailyQuotaLimits,
  caseDeletionBlockReason,
} = require("../dist/modules/eligibility/eligibility.service.js");
const {
  isUsableCaseDocument,
} = require("../dist/modules/documents/document-requirements.js");
const {
  classifyVisibleOrangeInvoiceText,
} = require("../dist/platform/local-pdf-dlp.service.js");
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

test("only telecom invoices and game rules can enter an AI flow", () => {
  assert.equal(canSendDocumentToAi("ORANGE_INVOICE"), true);
  assert.equal(canSendDocumentToAi("GAME_RULE_PDF"), true);
  assert.equal(canSendDocumentToAi("IDENTITY_DOCUMENT"), false);
  assert.equal(canSendDocumentToAi("BANK_DETAILS"), false);
  assert.throws(
    () => requireDocumentEligibleForAi("IDENTITY_DOCUMENT"),
    /ne peut pas être transmis à une IA/,
  );
});

test("fails closed when a client labels sensitive or ambiguous content as an invoice", () => {
  const identity = classifyVisibleOrangeInvoiceText(
    "Carte nationale d identite Republique francaise Orange facture total TVA client",
  );
  assert.deepEqual(identity, {
    accepted: false,
    reason: "SENSITIVE_MARKERS",
  });
  assert.equal(
    classifyVisibleOrangeInvoiceText(
      "Orange facture montant total TVA client IBAN FR76 1234 5678 9012 3456 7890 123",
    ).accepted,
    false,
  );
  assert.equal(
    classifyVisibleOrangeInvoiceText(
      "Orange facture montant total TVA R I B I B A N FR76 1234 5678 9012 3456 7890 123 B I C",
    ).accepted,
    false,
  );
  assert.equal(
    classifyVisibleOrangeInvoiceText("document illisible").accepted,
    false,
  );

  const invoice = classifyVisibleOrangeInvoiceText(
    "Orange France facture numero client montant total TVA abonnement mobile",
  );
  assert.deepEqual(invoice, {
    accepted: true,
    reason: "TRUSTED_ORANGE_INVOICE",
  });
  const bouyguesInvoice = classifyVisibleOrangeInvoiceText(
    "Bouygues Telecom facture numero client montant total TVA abonnement mobile",
  );
  assert.deepEqual(bouyguesInvoice, {
    accepted: true,
    reason: "TRUSTED_ORANGE_INVOICE",
  });
  assert.equal(
    classifyVisibleOrangeInvoiceText(
      "Banque Bouygues Telecom releve d identite bancaire facture montant total mobile",
    ).accepted,
    false,
  );
  assert.equal(classifyVisibleOrangeInvoiceText("").accepted, false);
});

test("enforces an account quota before calling the OCR provider", async () => {
  const previousAccountLimit = process.env.AI_DAILY_ACCOUNT_CALL_LIMIT;
  const previousProviderLimit = process.env.MISTRAL_DAILY_CALL_LIMIT;
  process.env.AI_DAILY_ACCOUNT_CALL_LIMIT = "1";
  process.env.MISTRAL_DAILY_CALL_LIMIT = "100";
  let quotaCountCalls = 0;
  let providerCalls = 0;
  const prisma = {
    document: {
      findFirst: async () => ({
        id: "doc-1",
        ownerId: "user-1",
        kind: "ORANGE_INVOICE",
        mimeType: "application/pdf",
        storageBucket: "documents",
        storageKey: "doc-1.enc",
        checksumSha256: "a".repeat(64),
        sizeBytes: 100,
        ocrResult: null,
      }),
    },
    gameRule: {
      findFirst: async () => ({
        id: "rule-1",
        status: "APPROVED",
        organizer: { name: "Orange" },
      }),
    },
    auditLog: { create: async () => ({ id: "consent-1" }) },
    $transaction: async (operation) =>
      operation({
        $executeRaw: async () => 1,
        auditLog: {
          count: async () => (quotaCountCalls++ === 0 ? 0 : 1),
          create: async () => {
            throw new Error("quota reservation must not be created");
          },
        },
      }),
  };
  const service = new EligibilityService(
    prisma,
    {
      getDecryptedObject: async () =>
        Buffer.from(
          "%PDF-1.7 Orange France facture numero client montant total TVA abonnement mobile",
        ),
    },
    {},
    undefined,
    {
      classify: async () => ({
        accepted: true,
        reason: "TRUSTED_ORANGE_INVOICE",
      }),
    },
  );
  service.mistralOcr = {
    extractText: async () => {
      providerCalls += 1;
      return { provider: "mistral", text: "unexpected" };
    },
  };

  try {
    await assert.rejects(
      service.analyzeInvoice("doc-1", "user-1", "rule-1", true),
      (error) => error?.getStatus?.() === 429,
    );
    assert.equal(providerCalls, 0);
  } finally {
    restoreEnv("AI_DAILY_ACCOUNT_CALL_LIMIT", previousAccountLimit);
    restoreEnv("MISTRAL_DAILY_CALL_LIMIT", previousProviderLimit);
  }
});

test("bounds AI quotas and configures automatic retention safely", () => {
  assert.deepEqual(
    aiDailyQuotaLimits({
      AI_DAILY_ACCOUNT_CALL_LIMIT: "0",
      MISTRAL_DAILY_CALL_LIMIT: "999999999",
    }),
    { account: 0, provider: 100000 },
  );
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
