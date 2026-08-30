const assert = require("node:assert/strict");
const test = require("node:test");
const { createHash } = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

const scriptUrl = pathToFileURL(
  resolve(__dirname, "../../../scripts/backfill-generated-packet-sizes.mjs"),
).href;

test("generated-packet cutover backfills only an integrity-checked exact size", async () => {
  const { auditGeneratedPacketSizes } = await import(scriptUrl);
  const bytes = Buffer.from("%PDF-1.7\nlegacy packet");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  let updateWhere;
  let auditData;
  const transaction = {
    $executeRaw: async () => 0,
    generatedPacket: {
      updateMany: async ({ where, data }) => {
        updateWhere = where;
        assert.deepEqual(data, { sizeBytes: bytes.byteLength });
        return { count: 1 };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        auditData = data;
        return {};
      },
    },
  };
  const prisma = {
    generatedPacket: {
      findMany: async () => [
        {
          id: "packet-1",
          caseId: "case-1",
          storageBucket: "local-documents",
          storageKey: "2026-08-03/legacy.bin",
          checksumSha256,
          sizeBytes: 0,
          case: { ownerId: "user-1" },
        },
      ],
    },
    $transaction: async (operation) => operation(transaction),
  };
  const storage = {
    getDecryptedObject: async ({ encryptionContext }) => {
      assert.deepEqual(encryptionContext, {
        ownerId: "user-1",
        caseId: "case-1",
        purpose: "GENERATED_PACKET",
      });
      return bytes;
    },
  };

  const report = await auditGeneratedPacketSizes({
    prisma,
    storage,
    apply: true,
  });

  assert.deepEqual(report, {
    mode: "apply",
    scanned: 1,
    verified: 1,
    updated: 1,
    failures: [],
  });
  assert.deepEqual(updateWhere, {
    id: "packet-1",
    caseId: "case-1",
    storageBucket: "local-documents",
    storageKey: "2026-08-03/legacy.bin",
    checksumSha256,
    sizeBytes: { lte: 0 },
  });
  assert.equal(auditData.action, "GENERATED_PACKET_SIZE_BACKFILLED");
  assert.equal(auditData.metadata.checksumVerified, true);
});

test("generated-packet cutover refuses a checksum mismatch without writing", async () => {
  const { auditGeneratedPacketSizes } = await import(scriptUrl);
  let transactionCalls = 0;
  const prisma = {
    generatedPacket: {
      findMany: async () => [
        {
          id: "packet-2",
          caseId: "case-2",
          storageBucket: "local-documents",
          storageKey: "2026-08-03/corrupt.bin",
          checksumSha256: "a".repeat(64),
          sizeBytes: 0,
          case: { ownerId: "user-2" },
        },
      ],
    },
    $transaction: async () => {
      transactionCalls += 1;
    },
  };

  const report = await auditGeneratedPacketSizes({
    prisma,
    storage: {
      getDecryptedObject: async () => Buffer.from("not the expected packet"),
    },
    apply: true,
  });

  assert.deepEqual(report, {
    mode: "apply",
    scanned: 1,
    verified: 0,
    updated: 0,
    failures: [{ packetId: "packet-2", code: "PACKET_INTEGRITY_MISMATCH" }],
  });
  assert.equal(transactionCalls, 0);
});
