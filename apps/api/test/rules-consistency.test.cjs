const assert = require("node:assert/strict");
const test = require("node:test");

const {
  RulesService,
  gameRuleContentFingerprint,
} = require("../dist/modules/rules/rules.service.js");

function presentableRule(overrides = {}) {
  return {
    id: "rule-1",
    organizerId: "organizer-1",
    sourceDocumentId: "document-1",
    status: "NEEDS_REVIEW",
    version: 2,
    name: "Jeu A",
    reimbursementCents: 500,
    requiredDocuments: [],
    constraintsJson: { channelName: "M6" },
    validFrom: null,
    validUntil: null,
    reviewedAt: null,
    organizer: { id: "organizer-1", name: "M6" },
    sourceDocument: {
      id: "document-1",
      originalName: "reglement.pdf",
      uploadedAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    ...overrides,
  };
}

test("stale approval cannot approve content edited after the administrator review", async () => {
  const locks = [];
  let approved = false;
  let audited = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    gameRule: {
      findFirst: async () => presentableRule({ version: 2 }),
      updateMany: async () => {
        approved = true;
        return { count: 1 };
      },
    },
    auditLog: {
      create: async () => {
        audited = true;
      },
    },
  };
  const service = new RulesService(
    { $transaction: async (operation) => operation(transaction) },
    {},
  );

  await assert.rejects(
    () => service.approve("rule-1", "admin-1", 1),
    /a change depuis son chargement/i,
  );
  assert.deepEqual(locks, ["game-rule:rule-1"]);
  assert.equal(approved, false);
  assert.equal(audited, false);
});

test("every content edit increments the CAS version and commits its audit atomically", async () => {
  const before = presentableRule({
    status: "APPROVED",
    version: 4,
    reviewedAt: new Date("2026-08-01T00:00:00.000Z"),
  });
  const after = presentableRule({
    status: "NEEDS_REVIEW",
    version: 5,
    name: "Jeu B",
  });
  let reads = 0;
  let updateInput;
  let auditInput;
  const transaction = {
    $executeRaw: async () => 0,
    gameRule: {
      findFirst: async () => (reads++ === 0 ? before : after),
      updateMany: async (input) => {
        updateInput = input;
        return { count: 1 };
      },
    },
    organizer: { upsert: async () => ({ id: "organizer-1" }) },
    auditLog: {
      create: async (input) => {
        auditInput = input;
        return {};
      },
    },
  };
  const service = new RulesService(
    { $transaction: async (operation) => operation(transaction) },
    {},
  );
  const result = await service.update("rule-1", {
    actorId: "admin-1",
    expectedVersion: 4,
    organizerName: "M6",
    name: "Jeu B",
    reimbursementCents: 500,
    requiredDocuments: [],
    constraints: { channelName: "M6" },
  });

  assert.equal(result.version, 5);
  assert.deepEqual(updateInput.where, {
    id: "rule-1",
    version: 4,
    status: "APPROVED",
  });
  assert.deepEqual(updateInput.data.version, { increment: 1 });
  assert.equal(updateInput.data.status, "NEEDS_REVIEW");
  assert.equal(updateInput.data.reviewedAt, null);
  assert.equal(auditInput.data.action, "GAME_RULE_UPDATED");
  assert.deepEqual(auditInput.data.metadata, {
    previousVersion: 4,
    version: 5,
    previousStatus: "APPROVED",
    status: "NEEDS_REVIEW",
  });
});

test("approval CAS and content fingerprint are recorded in the same transaction", async () => {
  const before = presentableRule({ version: 7 });
  const after = presentableRule({
    version: 7,
    status: "APPROVED",
    reviewedAt: new Date("2026-08-10T00:00:00.000Z"),
  });
  let reads = 0;
  let updateInput;
  let auditInput;
  const transaction = {
    $executeRaw: async () => 0,
    gameRule: {
      findFirst: async () => (reads++ === 0 ? before : after),
      updateMany: async (input) => {
        updateInput = input;
        return { count: 1 };
      },
    },
    auditLog: {
      create: async (input) => {
        auditInput = input;
        return {};
      },
    },
  };
  const service = new RulesService(
    { $transaction: async (operation) => operation(transaction) },
    {},
  );
  const result = await service.approve("rule-1", "admin-1", 7);

  assert.equal(result.status, "APPROVED");
  assert.deepEqual(updateInput.where, {
    id: "rule-1",
    version: 7,
    status: "NEEDS_REVIEW",
  });
  assert.equal(auditInput.data.action, "GAME_RULE_APPROVED");
  assert.equal(auditInput.data.metadata.version, 7);
  assert.equal(
    auditInput.data.metadata.contentSha256,
    gameRuleContentFingerprint(after),
  );
  assert.match(auditInput.data.metadata.contentSha256, /^[a-f\d]{64}$/);
});

test("rule extraction rechecks its source and commits derived data with its audit", async () => {
  const operations = [];
  const source = {
    id: "document-1",
    ownerId: "admin-1",
    kind: "GAME_RULE_PDF",
    ocrResult: {
      text: "encrypted-ocr",
      provider: "mistral",
      confidence: null,
      rawJson: {},
    },
  };
  const transaction = {
    $executeRaw(_strings, lockKey) {
      operations.push(`LOCK:${lockKey}`);
      return Promise.resolve(0);
    },
    document: {
      findFirst: async () => ({ id: source.id }),
      update: async () => {
        operations.push("DOCUMENT_UPDATED");
        return {};
      },
    },
    ocrResult: {
      upsert: async () => {
        operations.push("OCR_UPSERTED");
        return {};
      },
    },
    documentAnalysis: {
      create: async () => {
        operations.push("ANALYSIS_CREATED");
        return {};
      },
    },
    auditLog: {
      create: async ({ data }) => {
        operations.push(`AUDIT:${data.action}`);
        return {};
      },
    },
  };
  const service = new RulesService(
    {
      document: { findFirst: async () => source },
      documentAnalysis: { findFirst: async () => null },
      $transaction: async (operation) => operation(transaction),
    },
    {},
    {
      decrypt: () => "rule text",
      encrypt: () => "encrypted-ocr",
    },
  );
  service.analyzeRuleText = async () => ({
    organizerName: "M6",
    name: "Jeu A",
    reimbursementCents: 500,
    requiredDocuments: [],
    constraints: {},
    confidence: 0.9,
  });

  const candidate = await service.extractCandidate("document-1", "admin-1");

  assert.equal(candidate.sourceDocumentId, "document-1");
  assert.deepEqual(operations, [
    "LOCK:document-lifecycle:document-1",
    "OCR_UPSERTED",
    "ANALYSIS_CREATED",
    "DOCUMENT_UPDATED",
    "AUDIT:GAME_RULE_EXTRACTED",
  ]);
});
