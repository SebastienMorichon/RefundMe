const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DocumentLifecycleService,
  documentDeletionBlockReason,
  retentionExpirationBlockReason,
} = require("../dist/modules/documents/document-lifecycle.service.js");
const {
  EligibilityService,
  caseRefundBlockReason,
} = require("../dist/modules/eligibility/eligibility.service.js");

test("document deletion blockers cover payment, packet, final and postal states", () => {
  assert.equal(
    documentDeletionBlockReason({
      status: "READY_TO_PAY",
      paymentStatus: "PENDING",
      generatedPacketCount: 0,
      postalShipmentStatus: "QUOTED",
    }),
    "PAYMENT_PENDING",
  );
  assert.equal(
    documentDeletionBlockReason({
      status: "READY_TO_PAY",
      paymentStatus: null,
      generatedPacketCount: 1,
      postalShipmentStatus: null,
    }),
    "PACKET_GENERATED",
  );
  assert.equal(
    documentDeletionBlockReason({
      status: "READY_TO_PAY",
      paymentStatus: null,
      generatedPacketCount: 0,
      postalShipmentStatus: "SUBMITTING",
    }),
    "SHIPMENT_STATUS_SUBMITTING",
  );
});

test("requestDeletion locks and re-reads before a concurrent PENDING checkout", async () => {
  const locks = [];
  let detached = false;
  let tombstoned = false;
  const safeCase = {
    caseId: "case-1",
    case: {
      status: "READY_TO_PAY",
      payment: null,
      postalShipment: { status: "QUOTED" },
      _count: { generatedPackets: 0 },
    },
  };
  const pendingCase = {
    ...safeCase,
    case: { ...safeCase.case, payment: { status: "PENDING" } },
  };
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    document: {
      findFirst: async () => ({
        id: "doc-1",
        caseDocuments: [pendingCase],
      }),
      updateMany: async () => {
        tombstoned = true;
        return { count: 1 };
      },
    },
    caseDocument: {
      deleteMany: async () => {
        detached = true;
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new DocumentLifecycleService(
    {
      document: {
        findFirst: async () => ({ caseDocuments: [{ caseId: "case-1" }] }),
      },
      $transaction: async (operation) => operation(transaction),
    },
    {},
    {},
  );

  await assert.rejects(
    () => service.requestDeletion("doc-1", "user-1"),
    /paiement en cours/i,
  );
  assert.deepEqual(locks, [
    "stripe-checkout:case-1",
    "generated-packet:case-1",
    "document-lifecycle:doc-1",
  ]);
  assert.equal(detached, false);
  assert.equal(tombstoned, false);
});

test("requestDeletion rejects a newly discovered attachment without reversing case/document locks", async () => {
  const locks = [];
  let tombstoned = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    document: {
      findFirst: async () => ({
        id: "doc-1",
        caseDocuments: [
          {
            caseId: "case-new",
            case: {
              status: "READY_TO_PAY",
              payment: null,
              postalShipment: { status: "QUOTED" },
              _count: { generatedPackets: 0 },
            },
          },
        ],
      }),
      updateMany: async () => {
        tombstoned = true;
        return { count: 1 };
      },
    },
  };
  const service = new DocumentLifecycleService(
    {
      document: { findFirst: async () => ({ caseDocuments: [] }) },
      $transaction: async (operation) => operation(transaction),
    },
    {},
    {},
  );
  await assert.rejects(
    () => service.requestDeletion("doc-1", "user-1"),
    /vient d'etre rattache/i,
  );
  assert.deepEqual(locks, ["document-lifecycle:doc-1"]);
  assert.equal(tombstoned, false);
});

test("a failed staging transaction never performs physical storage I/O", async () => {
  let storageDeletes = 0;
  const queries = [
    [],
    [],
    [
      {
        id: "doc-1",
        storageBucket: "local-documents",
        storageKey: "2026-08-03/00000000-0000-4000-8000-000000000001.bin",
        checksumSha256: "a".repeat(64),
        sizeBytes: 10,
        storageRevisions: [],
      },
    ],
  ];
  const transaction = {
    $queryRaw: async () => [{ acquired: true }],
    $executeRaw: async () => 0,
    document: { findMany: async () => queries.shift() ?? [] },
    documentStorageRevision: { findMany: async () => [] },
    generatedPacket: { findMany: async () => [] },
    storagePurgeJob: { upsert: async () => ({}) },
  };
  const service = new DocumentLifecycleService(
    {
      $transaction: async (operation) => {
        await operation(transaction);
        throw new Error("simulated commit failure");
      },
    },
    {
      deleteObject: async () => {
        storageDeletes += 1;
      },
    },
    {},
  );

  await assert.rejects(
    () => service.runRetention({ actorId: null, dryRun: false }),
    /commit failure/,
  );
  assert.equal(storageDeletes, 0);
});

test("an OBJECT_DELETED outbox job resumes SQL finalization without deleting twice", async () => {
  let job = {
    id: "job-1",
    groupType: "REVISION",
    groupId: "revision-1",
    entityType: "DOCUMENT_REVISION",
    entityId: "revision-1",
    storageBucket: "local-documents",
    storageKey: "2026-08-03/00000000-0000-4000-8000-000000000002.bin",
    checksumSha256: "b".repeat(64),
    sizeBytes: 10,
    status: "PENDING",
    attempts: 0,
    lastError: null,
    objectDeletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let storageDeletes = 0;
  let finalized = false;
  let transactionCalls = 0;
  let failFirstFinalization = true;
  const stagingTransaction = {
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ acquired: true }],
    document: { findMany: async () => [] },
    documentStorageRevision: { findMany: async () => [] },
    generatedPacket: { findMany: async () => [] },
    storageWriteReservation: { deleteMany: async () => ({ count: 0 }) },
  };
  const finalTransaction = {
    $executeRaw: async () => 0,
    storagePurgeJob: {
      findUnique: async () => job,
      count: async () => 0,
      deleteMany: async () => {
        job = null;
        return { count: 1 };
      },
    },
    storageWriteReservation: { findMany: async () => [] },
    documentStorageRevision: {
      updateMany: async () => {
        finalized = true;
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const prisma = {
    storagePurgeJob: {
      findMany: async () => (job ? [job] : []),
      updateMany: async ({ where, data }) => {
        if (!job || job.id !== where.id || job.status !== where.status) {
          return { count: 0 };
        }
        job = {
          ...job,
          ...data,
          attempts: job.attempts + (data.attempts?.increment ?? 0),
        };
        return { count: 1 };
      },
    },
    storageWriteReservation: { findMany: async () => [] },
    $transaction: async (operation) => {
      transactionCalls += 1;
      if (transactionCalls % 2 === 1) return operation(stagingTransaction);
      if (failFirstFinalization) {
        failFirstFinalization = false;
        throw new Error("database unavailable after object deletion");
      }
      return operation(finalTransaction);
    },
  };
  const service = new DocumentLifecycleService(
    prisma,
    {
      deleteObject: async () => {
        storageDeletes += 1;
      },
    },
    {},
  );

  await assert.rejects(
    () => service.runRetention({ actorId: null, dryRun: false }),
    /database unavailable/,
  );
  assert.equal(storageDeletes, 1);
  assert.equal(job.status, "OBJECT_DELETED");
  assert.equal(finalized, false);

  const recovered = await service.runRetention({
    actorId: null,
    dryRun: false,
  });
  assert.equal(storageDeletes, 1);
  assert.equal(finalized, true);
  assert.equal(job, null);
  assert.deepEqual(recovered.revisionResults, [
    { id: "revision-1", status: "PURGED" },
  ]);
});

test("a document purge regroups every tombstoned revision before SQL cascade", async () => {
  const document = {
    id: "doc-1",
    storageBucket: "local-documents",
    storageKey: "primary.bin",
    checksumSha256: "a".repeat(64),
    sizeBytes: 20,
    deletedAt: new Date("2026-08-01T00:00:00.000Z"),
    purgeAfter: new Date("2026-08-02T00:00:00.000Z"),
  };
  const revision = {
    id: "revision-1",
    documentId: document.id,
    storageBucket: "local-documents",
    storageKey: "revision.bin",
    checksumSha256: "b".repeat(64),
    sizeBytes: 10,
    deletedAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  const documentQueries = [
    [],
    [],
    [{ ...document, storageRevisions: [revision] }],
  ];
  const jobs = new Map();
  const transaction = {
    $executeRaw: async () => 0,
    document: {
      findMany: async () => documentQueries.shift() ?? [],
      findFirst: async () => ({ ...document, storageRevisions: [revision] }),
    },
    documentStorageRevision: {
      findMany: async () => [revision],
      updateMany: async () => ({ count: 1 }),
    },
    generatedPacket: { findMany: async () => [] },
    storagePurgeJob: {
      upsert: async ({ where, create, update }) => {
        const key = `${where.storageBucket_storageKey.storageBucket}/${where.storageBucket_storageKey.storageKey}`;
        jobs.set(key, jobs.has(key) ? { ...jobs.get(key), ...update } : create);
        return jobs.get(key);
      },
    },
  };
  const service = new DocumentLifecycleService({}, {}, {});
  await service.executeRetention(transaction, {
    actorId: null,
    dryRun: false,
  });

  assert.equal(jobs.get("local-documents/revision.bin").groupType, "DOCUMENT");
  assert.equal(jobs.get("local-documents/revision.bin").groupId, document.id);
  assert.equal(jobs.get("local-documents/primary.bin").entityType, "DOCUMENT");
});

test("an expired stored write lease survives cleanup failure and is reconciled on retry", async () => {
  let reservation = {
    id: "storage-reservation-1",
    purpose: "USER_UPLOAD",
    sizeBytes: 64,
    storageBucket: "local-documents",
    storageKey: "2026-08-03/00000000-0000-4000-8000-000000000099.bin",
    checksumSha256: "c".repeat(64),
    expiresAt: new Date("2026-08-03T00:00:00.000Z"),
    attempts: 0,
    lastError: null,
    objectDeletedAt: null,
    createdAt: new Date("2026-08-02T00:00:00.000Z"),
  };
  let deleteAttempts = 0;
  let auditWrites = 0;
  const transaction = {
    $executeRaw: async () => 0,
    storageWriteReservation: {
      deleteMany: async ({ where }) => {
        if (where.storageBucket === null) return { count: 0 };
        if (!reservation || reservation.id !== where.id) return { count: 0 };
        reservation = null;
        return { count: 1 };
      },
      findFirst: async ({ where }) =>
        reservation && reservation.id === where.id ? reservation : null,
      updateMany: async ({ where, data }) => {
        if (!reservation || reservation.id !== where.id) return { count: 0 };
        reservation = {
          ...reservation,
          attempts: reservation.attempts + (data.attempts?.increment ?? 0),
          lastError: data.lastError ?? reservation.lastError,
        };
        return { count: 1 };
      },
    },
    auditLog: {
      create: async () => {
        auditWrites += 1;
        return {};
      },
    },
  };
  const prisma = {
    storageWriteReservation: {
      findMany: async () => (reservation ? [reservation] : []),
    },
    $transaction: async (operation) => operation(transaction),
  };
  const service = new DocumentLifecycleService(
    prisma,
    {
      deleteObject: async () => {
        deleteAttempts += 1;
        if (deleteAttempts === 1) throw new Error("storage unavailable");
      },
    },
    {},
  );

  const failed = await service.processExpiredStorageWriteReservations(null);
  assert.deepEqual(failed, [
    {
      id: "storage-reservation-1",
      purpose: "USER_UPLOAD",
      status: "FAILED",
      error: "OPERATION_FAILED",
    },
  ]);
  assert.equal(reservation.attempts, 1);
  assert.equal(auditWrites, 0);

  const recovered =
    await service.processExpiredStorageWriteReservations("admin-1");
  assert.deepEqual(recovered, [
    {
      id: "storage-reservation-1",
      purpose: "USER_UPLOAD",
      status: "PURGED",
    },
  ]);
  assert.equal(deleteAttempts, 2);
  assert.equal(reservation, null);
  assert.equal(auditWrites, 1);
});

test("retention defers a document attached after candidate discovery instead of reversing lock order", async () => {
  const candidate = {
    id: "doc-1",
    kind: "IDENTITY_DOCUMENT",
    caseDocuments: [],
  };
  const documentQueries = [[candidate], [], []];
  let tombstoned = false;
  let detached = false;
  const transaction = {
    $executeRaw: async () => 0,
    document: {
      findMany: async () => documentQueries.shift() ?? [],
      findFirst: async () => ({
        ...candidate,
        caseDocuments: [
          {
            caseId: "case-new",
            case: {
              status: "READY_TO_PAY",
              payment: null,
              postalShipment: null,
              _count: { generatedPackets: 0 },
            },
          },
        ],
      }),
      updateMany: async () => {
        tombstoned = true;
        return { count: 1 };
      },
    },
    caseDocument: {
      deleteMany: async () => {
        detached = true;
        return { count: 1 };
      },
    },
    documentStorageRevision: { findMany: async () => [] },
    generatedPacket: { findMany: async () => [] },
  };
  const service = new DocumentLifecycleService({}, {}, {});
  const result = await service.executeRetention(transaction, {
    actorId: null,
    dryRun: false,
  });
  assert.equal(tombstoned, false);
  assert.equal(detached, false);
  assert.deepEqual(result.expirationResults, [
    {
      id: "doc-1",
      status: "DEFERRED",
      reason: "NEW_CASE_ATTACHMENT",
      caseIds: ["case-new"],
    },
  ]);
});

test("eligibility mutations share profile, checkout and packet locks", async () => {
  for (const invoke of [
    (service) => service.updateDetection("case-1", 2, 200, "user-1"),
    (service) => service.updatePostalExpenseClaim("case-1", false, "user-1"),
    (service) => service.confirmCase("case-1", "user-1"),
  ]) {
    const locks = [];
    const transaction = {
      $executeRaw(_strings, lockKey) {
        locks.push(lockKey);
        return Promise.resolve(0);
      },
      administrativeCase: {
        findFirst: async () => ({
          id: "case-1",
          status: "READY_TO_PAY",
          gameRule: {},
          payment: { status: "PENDING" },
          validatedAt: null,
        }),
      },
    };
    const service = new EligibilityService(
      { $transaction: async (operation) => operation(transaction) },
      {},
      { sendCaseEvent: async () => {} },
    );
    await assert.rejects(() => invoke(service), /paiement|validation|pieces/i);
    assert.deepEqual(locks, [
      "customer-profile:user-1",
      "stripe-checkout:case-1",
      "generated-packet:case-1",
    ]);
  }
});

test("attachment serializes profile, case artifacts and document lifecycle before rechecking", async () => {
  const locks = [];
  let attached = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findFirst: async () => ({
        id: "case-1",
        status: "READY_TO_PAY",
        gameRule: {},
        payment: { status: "PENDING" },
      }),
    },
    generatedPacket: { count: async () => 0 },
    caseDocument: {
      upsert: async () => {
        attached = true;
      },
    },
  };
  const service = new EligibilityService(
    { $transaction: async (operation) => operation(transaction) },
    {},
    { sendCaseEvent: async () => {} },
  );
  await assert.rejects(
    () => service.attachDocument("case-1", "doc-1", "user-1"),
    /pieces de ce dossier sont gelees/i,
  );
  assert.equal(attached, false);
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
    "document-lifecycle:doc-1",
  ]);
});

test("markRefunded cannot race an open Stripe checkout", async () => {
  const locks = [];
  let updated = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findFirst: async () => ({
        id: "case-1",
        status: "READY_TO_PAY",
        gameRule: {},
        payment: { status: "PENDING" },
        validatedAt: new Date(),
        fulfillmentMode: "MANAGED_POSTAL",
      }),
      updateMany: async () => {
        updated = true;
        return { count: 1 };
      },
    },
  };
  const service = new EligibilityService(
    { $transaction: async (operation) => operation(transaction) },
    {},
    { sendCaseEvent: async () => {} },
  );
  await assert.rejects(
    () => service.markRefunded("case-1", "user-1"),
    /paiement Stripe est encore ouvert/i,
  );
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
  ]);
  assert.equal(updated, false);
});

test("postal submission requires both a PAID payment and a PAID case", async () => {
  let claimed = false;
  const operationOrder = [];
  const transaction = {
    $executeRaw(_strings, lockKey) {
      operationOrder.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findUnique: async () => {
        operationOrder.push("READ_CASE");
        return { ownerId: "user-1" };
      },
      findFirst: async () => {
        operationOrder.push("READ_ACTIVE_CASE");
        return {
          id: "case-1",
          ownerId: "user-1",
          status: "REFUNDED",
          fulfillmentMode: "MANAGED_POSTAL",
          serviceFeeCents: 299,
          payment: { status: "PAID", amountCents: 799 },
          postalShipment: {
            id: "shipment-1",
            status: "QUOTED",
            providerUid: "postal-1",
            totalCents: 500,
          },
        };
      },
    },
    postalShipment: {
      updateMany: async () => {
        claimed = true;
        return { count: 1 };
      },
    },
  };
  const service =
    new (require("../dist/modules/shipping/shipping.service.js").ShippingService)(
      {
        $transaction: async (operation) => operation(transaction),
      },
      {},
      {},
      {},
    );
  await service.submitPaidCase("case-1");
  assert.equal(claimed, false);
  assert.deepEqual(operationOrder, [
    "READ_CASE",
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "READ_ACTIVE_CASE",
  ]);
});

test("postal submission rechecks an active owner under canonical locks", async () => {
  const locks = [];
  let claimed = false;
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findUnique: async () => ({ ownerId: "user-1" }),
      findFirst: async () => null,
    },
    postalShipment: {
      updateMany: async () => {
        claimed = true;
        return { count: 1 };
      },
    },
  };
  const service =
    new (require("../dist/modules/shipping/shipping.service.js").ShippingService)(
      {
        $transaction: async (operation) => operation(transaction),
      },
      {},
      {},
      {},
    );

  await service.submitPaidCase("case-1");

  assert.equal(claimed, false);
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
  ]);
});

test("markRefunded rejects the in-flight postal claim but remains available after submission", async () => {
  assert.equal(
    caseRefundBlockReason({
      status: "PAID",
      paymentStatus: "PAID",
      postalShipmentStatus: "SUBMITTING",
    }),
    "SHIPMENT_STATUS_SUBMITTING",
  );
  assert.equal(
    caseRefundBlockReason({
      status: "SENT",
      paymentStatus: "PAID",
      postalShipmentStatus: "DELIVERED",
    }),
    null,
  );

  let changed = false;
  const locks = [];
  const transaction = {
    $executeRaw(_strings, lockKey) {
      locks.push(lockKey);
      return Promise.resolve(0);
    },
    administrativeCase: {
      findFirst: async () => ({
        id: "case-1",
        status: "PAID",
        gameRule: {},
        payment: { status: "PAID" },
        postalShipment: { status: "SUBMITTING" },
        validatedAt: new Date(),
        fulfillmentMode: "MANAGED_POSTAL",
      }),
      updateMany: async () => {
        changed = true;
        return { count: 1 };
      },
    },
  };
  const service = new EligibilityService(
    { $transaction: async (operation) => operation(transaction) },
    {},
    { sendCaseEvent: async () => {} },
  );
  await assert.rejects(
    () => service.markRefunded("case-1", "user-1"),
    /traitement postal/i,
  );
  assert.equal(changed, false);
  assert.deepEqual(locks, [
    "customer-profile:user-1",
    "stripe-checkout:case-1",
    "generated-packet:case-1",
  ]);
});

test("retention defers an object while payment or postal submission is in flight", () => {
  assert.equal(
    retentionExpirationBlockReason({
      paymentStatus: "PENDING",
      postalShipmentStatus: "QUOTED",
    }),
    "PAYMENT_PENDING",
  );
  assert.equal(
    retentionExpirationBlockReason({
      paymentStatus: "PAID",
      postalShipmentStatus: "SUBMITTING",
    }),
    "SHIPMENT_SUBMISSION_UNCERTAIN",
  );
  assert.equal(
    retentionExpirationBlockReason({
      paymentStatus: "PAID",
      postalShipmentStatus: "SUBMITTED",
    }),
    null,
  );
});
