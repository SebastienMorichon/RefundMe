const assert = require("node:assert/strict");
const test = require("node:test");

const {
  InactiveDocumentOwnerError,
  PrismaDocumentRepository,
} = require("../dist/modules/documents/prisma-document.repository.js");
const {
  GlobalDocumentStorageQuotaError,
  StorageWriteReservations,
} = require("../dist/platform/storage-write-reservations.js");

test("a tombstoned document consumes upload quota until physical purge removes its row", async () => {
  let documentRows = 1;
  const documentWhere = [];
  let reservationsCreated = 0;
  const transaction = {
    $executeRaw: async () => 0,
    user: { findFirst: async () => ({ id: "user-1" }) },
    document: {
      aggregate: async ({ where } = {}) => {
        if (where) documentWhere.push(where);
        return {
          _count: { _all: documentRows },
          _sum: { sizeBytes: documentRows * 10 },
        };
      },
    },
    documentStorageRevision: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    storagePurgeJob: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    storageWriteReservation: {
      deleteMany: async () => ({ count: 0 }),
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
      create: async () => ({ id: "storage-reservation-1" }),
    },
    generatedPacket: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    documentUploadReservation: {
      deleteMany: async () => ({ count: 0 }),
      aggregate: async ({ where } = {}) => ({
        _count: { _all: 0 },
        _sum: { sizeBytes: 0 },
        where,
      }),
      create: async () => {
        reservationsCreated += 1;
        return { id: "reservation-1" };
      },
    },
  };
  const repository = new PrismaDocumentRepository({
    $transaction: async (operation) => operation(transaction),
  });
  const limits = { maxDocuments: 1, maxStoredBytes: 100 };

  const whileTombstoned = await repository.reserveOwnerUpload(
    "user-1",
    10,
    limits,
  );
  assert.equal(whileTombstoned, null);
  assert.equal(reservationsCreated, 0);
  assert.deepEqual(documentWhere[0], { ownerId: "user-1" });

  // DocumentLifecycleService deletes the row only after the encrypted object
  // and every grouped revision were physically removed.
  documentRows = 0;
  const afterPhysicalPurge = await repository.reserveOwnerUpload(
    "user-1",
    10,
    limits,
  );
  assert.equal(afterPhysicalPurge, "reservation-1");
  assert.equal(reservationsCreated, 1);
  assert.deepEqual(documentWhere[1], { ownerId: "user-1" });
});

test("document persistence rechecks account activity immediately before insert", async () => {
  let activeChecks = 0;
  let persisted = false;
  const transaction = {
    $executeRaw: async () => 0,
    user: {
      async findFirst() {
        activeChecks += 1;
        return activeChecks === 1 ? { id: "user-1" } : null;
      },
    },
    document: {
      async aggregate() {
        return { _count: { _all: 0 }, _sum: { sizeBytes: 0 } };
      },
      async create() {
        persisted = true;
        return {};
      },
    },
    documentUploadReservation: {
      async aggregate() {
        return { _count: { _all: 0 }, _sum: { sizeBytes: 0 } };
      },
    },
  };
  const repository = new PrismaDocumentRepository({
    $transaction: async (operation) => operation(transaction),
  });

  await assert.rejects(
    () =>
      repository.createWithinOwnerLimits(
        {
          ownerId: "user-1",
          kind: "OTHER",
          originalName: "preuve.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          storageBucket: "documents",
          storageKey: "user-1/proof.enc",
          checksumSha256: "a".repeat(64),
          watermarked: false,
        },
        { maxDocuments: 10, maxStoredBytes: 1_000 },
      ),
    InactiveDocumentOwnerError,
  );
  assert.equal(activeChecks, 2);
  assert.equal(persisted, false);
});

test("a durable global byte budget includes documents, revisions and generated packets", async () => {
  const previousLimit = process.env.DOCUMENT_STORAGE_GLOBAL_BYTES;
  process.env.DOCUMENT_STORAGE_GLOBAL_BYTES = "100";
  let reservationCreated = false;
  const transaction = {
    $executeRaw: async () => 0,
    user: { findFirst: async () => ({ id: "user-1" }) },
    document: {
      aggregate: async ({ where } = {}) =>
        where
          ? { _count: { _all: 0 }, _sum: { sizeBytes: 0 } }
          : { _sum: { sizeBytes: 40 } },
    },
    documentStorageRevision: {
      aggregate: async () => ({ _sum: { sizeBytes: 30 } }),
    },
    storagePurgeJob: {
      aggregate: async () => ({ _sum: { sizeBytes: 5 } }),
    },
    storageWriteReservation: {
      deleteMany: async () => ({ count: 0 }),
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
      create: async () => {
        reservationCreated = true;
        return { id: "storage-reservation-1" };
      },
    },
    generatedPacket: {
      aggregate: async () => ({ _sum: { sizeBytes: 20 } }),
    },
    documentUploadReservation: {
      deleteMany: async () => ({ count: 0 }),
      aggregate: async ({ where } = {}) => ({
        _count: { _all: 0 },
        _sum: { sizeBytes: 0 },
      }),
      create: async () => {
        reservationCreated = true;
        return { id: "reservation-1" };
      },
    },
  };
  const repository = new PrismaDocumentRepository({
    $transaction: async (operation) => operation(transaction),
  });

  try {
    await assert.rejects(
      () =>
        repository.reserveOwnerUpload("user-1", 10, {
          maxDocuments: 10,
          maxStoredBytes: 1_000,
        }),
      /capacite globale/,
    );
    assert.equal(reservationCreated, false);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.DOCUMENT_STORAGE_GLOBAL_BYTES;
    } else {
      process.env.DOCUMENT_STORAGE_GLOBAL_BYTES = previousLimit;
    }
  }
});

test("resizing a pre-I/O lease atomically rejects transformed bytes beyond the global budget", async () => {
  const previousLimit = process.env.DOCUMENT_STORAGE_GLOBAL_BYTES;
  process.env.DOCUMENT_STORAGE_GLOBAL_BYTES = "100";
  let updated = false;
  const now = new Date("2026-08-10T10:00:00.000Z");
  const transaction = {
    $executeRaw: async () => 0,
    document: {
      aggregate: async () => ({ _sum: { sizeBytes: 80 } }),
    },
    documentStorageRevision: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    storagePurgeJob: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    generatedPacket: {
      aggregate: async () => ({ _sum: { sizeBytes: 0 } }),
    },
    documentUploadReservation: {
      aggregate: async () => ({ _sum: { sizeBytes: 10 } }),
    },
    storageWriteReservation: {
      findFirst: async () => ({ sizeBytes: 10 }),
      aggregate: async () => ({ _sum: { sizeBytes: 10 } }),
      updateMany: async () => {
        updated = true;
        return { count: 1 };
      },
    },
  };
  const reservations = new StorageWriteReservations({});

  try {
    await assert.rejects(
      reservations.resizeWithinTransaction(
        transaction,
        "storage-reservation-1",
        21,
        "USER_UPLOAD",
        now,
      ),
      GlobalDocumentStorageQuotaError,
    );
    assert.equal(updated, false);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.DOCUMENT_STORAGE_GLOBAL_BYTES;
    } else {
      process.env.DOCUMENT_STORAGE_GLOBAL_BYTES = previousLimit;
    }
  }
});
