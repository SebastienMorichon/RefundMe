import { PrismaClient } from "@prisma/client";
import infrastructure from "../packages/infrastructure/dist/index.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { LocalEncryptedObjectStorageProvider } = infrastructure;

export async function auditGeneratedPacketSizes({ prisma, storage, apply }) {
  const packets = await prisma.generatedPacket.findMany({
    where: { sizeBytes: { lte: 0 } },
    select: {
      id: true,
      caseId: true,
      storageBucket: true,
      storageKey: true,
      checksumSha256: true,
      sizeBytes: true,
      case: { select: { ownerId: true } },
    },
    orderBy: { id: "asc" },
  });
  const report = {
    mode: apply ? "apply" : "audit",
    scanned: packets.length,
    verified: 0,
    updated: 0,
    failures: [],
  };

  for (const packet of packets) {
    try {
      if (!packet.case.ownerId) throw new Error("PACKET_OWNER_MISSING");
      const bytes = await storage.getDecryptedObject({
        object: {
          bucket: packet.storageBucket,
          key: packet.storageKey,
          checksumSha256: packet.checksumSha256,
          sizeBytes: packet.sizeBytes,
        },
        encryptionContext: {
          ownerId: packet.case.ownerId,
          caseId: packet.caseId,
          purpose: "GENERATED_PACKET",
        },
      });
      const sizeBytes = bytes.byteLength;
      const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
      if (sizeBytes <= 0 || checksumSha256 !== packet.checksumSha256) {
        throw new Error("PACKET_INTEGRITY_MISMATCH");
      }
      report.verified += 1;
      if (!apply) continue;

      await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`generated-packet:${packet.caseId}`}))
        `;
        const updated = await transaction.generatedPacket.updateMany({
          where: {
            id: packet.id,
            caseId: packet.caseId,
            storageBucket: packet.storageBucket,
            storageKey: packet.storageKey,
            checksumSha256: packet.checksumSha256,
            sizeBytes: { lte: 0 },
          },
          data: { sizeBytes },
        });
        if (updated.count !== 1)
          throw new Error("PACKET_CHANGED_DURING_BACKFILL");
        await transaction.auditLog.create({
          data: {
            action: "GENERATED_PACKET_SIZE_BACKFILLED",
            entityType: "GeneratedPacket",
            entityId: packet.id,
            metadata: {
              source: "CUTOVER_CLI",
              sizeBytes,
              checksumVerified: true,
            },
          },
        });
      });
      report.updated += 1;
    } catch (error) {
      report.failures.push({
        packetId: packet.id,
        code: safeFailureCode(error),
      });
    }
  }

  return report;
}

function safeFailureCode(error) {
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z0-9_]{3,64}$/.test(message) ? message : "PACKET_BACKFILL_FAILED";
}

function parseApplyFlag(argv) {
  const unknown = argv.filter((argument) => argument !== "--apply");
  if (unknown.length > 0) throw new Error("UNSUPPORTED_ARGUMENT");
  return argv.includes("--apply");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");
  if (!process.env.DOCUMENT_STORAGE_DIR) {
    throw new Error("DOCUMENT_STORAGE_DIR_REQUIRED");
  }
  const apply = parseApplyFlag(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    const storage = new LocalEncryptedObjectStorageProvider(
      resolve(process.env.DOCUMENT_STORAGE_DIR),
    );
    const report = await auditGeneratedPacketSizes({ prisma, storage, apply });
    const remaining = apply
      ? await prisma.generatedPacket.count({
          where: { sizeBytes: { lte: 0 } },
        })
      : report.scanned;
    process.stdout.write(`${JSON.stringify({ ...report, remaining })}\n`);
    if (report.failures.length > 0 || remaining > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        level: "error",
        type: "generated_packet_size_backfill_failed",
        code: safeFailureCode(error),
      })}\n`,
    );
    process.exitCode = 1;
  });
}
