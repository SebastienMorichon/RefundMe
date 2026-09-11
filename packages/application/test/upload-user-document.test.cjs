const assert = require("node:assert/strict");
const test = require("node:test");
const {
  UploadUserDocument,
} = require("../dist/use-cases/documents/upload-user-document.js");

const validPdf = Buffer.from("%PDF-1.7\n");

function createStorage() {
  const deleted = [];
  const stored = [];

  return {
    deleted,
    stored,
    async putEncryptedObject(input) {
      stored.push(input);
      return {
        bucket: "documents",
        key: "document.bin",
        checksumSha256: "checksum",
        sizeBytes: input.bytes.byteLength,
      };
    },
    async deleteObject(reference) {
      deleted.push(reference);
    },
  };
}

function createWatermarker(overrides = {}) {
  const calls = [];
  return {
    calls,
    async watermark(input) {
      calls.push(input);
      return {
        bytes: Buffer.from("%PDF-1.7\nwatermarked"),
        version: "test-v1",
        reference: "TEST123456",
        watermarkedAt: new Date("2026-08-01T10:00:00.000Z"),
      };
    },
    ...overrides,
  };
}

function createScanner(overrides = {}) {
  const calls = [];
  return {
    calls,
    async sanitize(input) {
      calls.push(input);
      return input.bytes;
    },
    ...overrides,
  };
}

test("rejects a file whose bytes do not match its declared mime type", async () => {
  const storage = createStorage();
  const documents = {
    create: async () => assert.fail("repository should not be called"),
  };
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    createScanner(),
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: "not-a-pdf.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("not a pdf"),
    }),
    /ne correspond pas au format declare/,
  );
  assert.equal(storage.deleted.length, 0);
});

test("removes the stored object when database persistence fails", async () => {
  const storage = createStorage();
  const documents = {
    create: async () => {
      throw new Error("database unavailable");
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    createScanner(),
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "ORANGE_INVOICE",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /database unavailable/,
  );
  assert.equal(storage.deleted.length, 1);
});

test("removes the encrypted object when account deletion wins before quota-checked persistence", async () => {
  const storage = createStorage();
  const released = [];
  const documents = {
    async reserveOwnerUpload() {
      return "reservation-1";
    },
    async listByOwner() {
      return [];
    },
    async createWithinOwnerLimits() {
      throw new Error("Le compte n'est plus actif.");
    },
    async releaseOwnerUpload(id, ownerId) {
      released.push({ id, ownerId });
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    createScanner(),
    { maxDocuments: 50, maxStoredBytes: 100 * 1024 * 1024 },
  );

  await assert.rejects(
    () =>
      useCase.execute({
        ownerId: "user-1",
        kind: "ORANGE_INVOICE",
        originalName: "invoice.pdf",
        mimeType: "application/pdf",
        bytes: validPdf,
      }),
    /compte n'est plus actif/,
  );
  assert.equal(storage.stored.length, 1);
  assert.equal(storage.deleted.length, 1);
  assert.deepEqual(released, [{ id: "reservation-1", ownerId: "user-1" }]);
});

test("resizes a durable upload lease after sanitizing and watermarking, before storage", async () => {
  const storage = createStorage();
  const events = [];
  const documents = {
    async reserveOwnerUpload() {
      events.push("reserve");
      return "reservation-1";
    },
    async resizeOwnerUploadReservation(id, ownerId, sizeBytes) {
      events.push(`resize:${id}:${ownerId}:${sizeBytes}`);
      return true;
    },
    async recordOwnerUploadStoredObject() {
      events.push("record");
    },
    async listByOwner() {
      return [];
    },
    async createWithinOwnerLimits(input) {
      events.push("persist");
      return {
        id: "document-1",
        status: "UPLOADED",
        encrypted: true,
        ...input,
      };
    },
    async releaseOwnerUpload() {
      events.push("release");
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    {
      ...storage,
      async putEncryptedObject(input) {
        events.push("put");
        return storage.putEncryptedObject(input);
      },
    },
    createWatermarker(),
    createScanner(),
    { maxDocuments: 50, maxStoredBytes: 100 * 1024 * 1024 },
  );

  await useCase.execute({
    ownerId: "user-1",
    kind: "IDENTITY_DOCUMENT",
    originalName: "identity.pdf",
    mimeType: "application/pdf",
    bytes: validPdf,
  });

  const resizedSize = Buffer.from("%PDF-1.7\nwatermarked").byteLength;
  assert.deepEqual(events, [
    "reserve",
    `resize:reservation-1:user-1:${resizedSize}`,
    "put",
    "record",
    "persist",
    "release",
  ]);
});

test("retains a recorded storage lease when persistence and orphan cleanup both fail", async () => {
  let recordCalls = 0;
  let releaseCalls = 0;
  const storage = createStorage();
  storage.deleteObject = async () => {
    throw new Error("storage unavailable");
  };
  const documents = {
    async reserveOwnerUpload() {
      return "reservation-1";
    },
    async resizeOwnerUploadReservation() {
      return true;
    },
    async recordOwnerUploadStoredObject() {
      recordCalls += 1;
    },
    async listByOwner() {
      return [];
    },
    async createWithinOwnerLimits() {
      throw new Error("database unavailable");
    },
    async releaseOwnerUpload() {
      releaseCalls += 1;
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    createScanner(),
    { maxDocuments: 50, maxStoredBytes: 100 * 1024 * 1024 },
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "ORANGE_INVOICE",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /database unavailable/,
  );
  assert.equal(recordCalls, 2);
  assert.equal(releaseCalls, 0);
});

test("watermarks sensitive documents before encrypted storage", async () => {
  const storage = createStorage();
  const watermarker = createWatermarker();
  let persistedInput;
  const documents = {
    async create(input) {
      persistedInput = input;
      return {
        id: "document-1",
        status: "UPLOADED",
        encrypted: true,
        ...input,
      };
    },
  };
  const scanner = createScanner();
  const useCase = new UploadUserDocument(
    documents,
    storage,
    watermarker,
    scanner,
  );

  const document = await useCase.execute({
    ownerId: "user-1",
    kind: "BANK_DETAILS",
    originalName: "rib.pdf",
    mimeType: "application/pdf",
    bytes: validPdf,
  });

  assert.equal(watermarker.calls.length, 1);
  assert.equal(scanner.calls.length, 1);
  assert.equal(storage.stored.length, 1);
  assert.equal(
    Buffer.from(storage.stored[0].bytes).toString(),
    "%PDF-1.7\nwatermarked",
  );
  assert.equal(persistedInput.watermarked, true);
  assert.equal(persistedInput.watermarkVersion, "test-v1");
  assert.equal(persistedInput.watermarkReference, "TEST123456");
  assert.equal(document.watermarked, true);
});

test("stores sensitive documents without a watermark when the protection is disabled", async () => {
  const storage = createStorage();
  const watermarker = createWatermarker({
    async watermark() {
      assert.fail("watermarker should not be called");
    },
  });
  let persistedInput;
  const documents = {
    async create(input) {
      persistedInput = input;
      return {
        id: "document-1",
        status: "UPLOADED",
        encrypted: true,
        ...input,
      };
    },
  };
  const scanner = createScanner();
  const useCase = new UploadUserDocument(
    documents,
    storage,
    watermarker,
    scanner,
    undefined,
    { watermarkSensitiveDocuments: false },
  );

  const document = await useCase.execute({
    ownerId: "user-1",
    kind: "BANK_DETAILS",
    originalName: "rib.pdf",
    mimeType: "application/pdf",
    bytes: validPdf,
  });

  assert.equal(watermarker.calls.length, 0);
  assert.equal(scanner.calls.length, 1);
  assert.equal(storage.stored.length, 1);
  assert.equal(
    Buffer.from(storage.stored[0].bytes).toString(),
    validPdf.toString(),
  );
  assert.equal(persistedInput.watermarked, false);
  assert.equal(persistedInput.watermarkVersion, null);
  assert.equal(persistedInput.watermarkReference, null);
  assert.equal(persistedInput.watermarkedAt, null);
  assert.equal(document.watermarked, false);
});

test("does not watermark ordinary documents", async () => {
  const storage = createStorage();
  const watermarker = createWatermarker({
    async watermark() {
      assert.fail("watermarker should not be called");
    },
  });
  let persistedInput;
  const documents = {
    async create(input) {
      persistedInput = input;
      return {
        id: "document-1",
        status: "UPLOADED",
        encrypted: true,
        ...input,
      };
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    storage,
    watermarker,
    createScanner(),
  );

  await useCase.execute({
    ownerId: "user-1",
    kind: "ORANGE_INVOICE",
    originalName: "invoice.pdf",
    mimeType: "application/pdf",
    bytes: validPdf,
  });

  assert.equal(storage.stored.length, 1);
  assert.equal(
    Buffer.from(storage.stored[0].bytes).toString(),
    validPdf.toString(),
  );
  assert.equal(persistedInput.watermarked, false);
});

test("does not store a sensitive document when watermarking fails", async () => {
  const storage = createStorage();
  const documents = {
    create: async () => assert.fail("repository should not be called"),
  };
  const watermarker = createWatermarker({
    async watermark() {
      throw new Error("watermark failed");
    },
  });
  const useCase = new UploadUserDocument(
    documents,
    storage,
    watermarker,
    createScanner(),
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "IDENTITY_DOCUMENT",
      originalName: "identity.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /watermark failed/,
  );
  assert.equal(storage.stored.length, 0);
});

test("rejects unsafe content before storage", async () => {
  const storage = createStorage();
  const documents = {
    create: async () => assert.fail("repository should not be called"),
  };
  const scanner = createScanner({
    async sanitize() {
      throw new Error("Document actif refuse");
    },
  });
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    scanner,
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "ORANGE_INVOICE",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /Document actif refuse/,
  );
  assert.equal(storage.stored.length, 0);
});

test("rejects misleading and oversized filenames", async () => {
  const useCase = new UploadUserDocument(
    { create: async () => assert.fail("repository should not be called") },
    createStorage(),
    createWatermarker(),
    createScanner(),
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: "payload.exe",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /extension/,
  );
  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: `${"a".repeat(181)}.pdf`,
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /nom du document/,
  );
});

test("rejects uploads once the account storage quota is reached", async () => {
  const documents = {
    async listByOwner() {
      return [
        {
          id: "existing",
          ownerId: "user-1",
          kind: "OTHER",
          status: "UPLOADED",
          originalName: "existing.pdf",
          mimeType: "application/pdf",
          sizeBytes: 10,
          storageBucket: "documents",
          storageKey: "key",
          checksumSha256: "checksum",
          encrypted: true,
          watermarked: false,
        },
      ];
    },
    create: async () => assert.fail("repository should not persist"),
  };
  const storage = createStorage();
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    createScanner(),
    { maxDocuments: 10, maxStoredBytes: 10 },
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /quota de documents/,
  );
  assert.equal(storage.stored.length, 0);
});

test("reserves account capacity before scanning or storing an upload", async () => {
  const storage = createStorage();
  let scannerCalled = false;
  const documents = {
    async reserveOwnerUpload() {
      return null;
    },
    async listByOwner() {
      assert.fail("usage should not be loaded");
    },
    async create() {
      assert.fail("repository should not persist");
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    storage,
    createWatermarker(),
    createScanner({
      async sanitize() {
        scannerCalled = true;
        return validPdf;
      },
    }),
    { maxDocuments: 50, maxStoredBytes: 100 * 1024 * 1024 },
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /quota de documents/,
  );
  assert.equal(scannerCalled, false);
  assert.equal(storage.stored.length, 0);
});

test("releases an upload reservation when CDR rejects the file", async () => {
  const released = [];
  const documents = {
    async reserveOwnerUpload() {
      return "reservation-1";
    },
    async releaseOwnerUpload(id, ownerId) {
      released.push({ id, ownerId });
    },
    async listByOwner() {
      return [];
    },
    async create() {
      assert.fail("repository should not persist");
    },
  };
  const useCase = new UploadUserDocument(
    documents,
    createStorage(),
    createWatermarker(),
    createScanner({
      async sanitize() {
        throw new Error("CDR rejected");
      },
    }),
    { maxDocuments: 50, maxStoredBytes: 100 * 1024 * 1024 },
  );

  await assert.rejects(
    useCase.execute({
      ownerId: "user-1",
      kind: "OTHER",
      originalName: "invoice.pdf",
      mimeType: "application/pdf",
      bytes: validPdf,
    }),
    /CDR rejected/,
  );
  assert.deepEqual(released, [{ id: "reservation-1", ownerId: "user-1" }]);
});
