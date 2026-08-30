import { Injectable } from "@nestjs/common";
import type { StoredObjectRef } from "@lydoc/application";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../modules/prisma/prisma.service";

export type StorageWritePurpose =
  "USER_UPLOAD" | "GENERATED_PACKET" | "DOCUMENT_REVISION";

export class GlobalDocumentStorageQuotaError extends Error {
  constructor() {
    super("La capacite globale du stockage documentaire est atteinte.");
    this.name = "GlobalDocumentStorageQuotaError";
  }
}

@Injectable()
export class StorageWriteReservations {
  constructor(private readonly prisma: PrismaService) {}

  async reserve(
    sizeBytes: number,
    purpose: StorageWritePurpose,
  ): Promise<string> {
    return this.prisma.$transaction(
      (transaction) =>
        this.reserveWithinTransaction(transaction, sizeBytes, purpose),
      { maxWait: 5_000, timeout: 15_000 },
    );
  }

  async reserveWithinTransaction(
    transaction: Prisma.TransactionClient,
    sizeBytes: number,
    purpose: StorageWritePurpose,
    now = new Date(),
  ): Promise<string> {
    assertStorageReservationSize(sizeBytes);
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
    `;
    await deleteExpiredUnstoredReservations(transaction, now);
    const usage = await readGlobalStorageUsage(transaction);
    if (usage.totalBytes + sizeBytes > globalDocumentStorageLimitBytes()) {
      throw new GlobalDocumentStorageQuotaError();
    }
    const reservation = await transaction.storageWriteReservation.create({
      data: {
        sizeBytes,
        purpose,
        expiresAt: storageWriteReservationExpiresAt(now),
      },
      select: { id: true },
    });
    return reservation.id;
  }

  async markStored(
    reservationId: string,
    object: StoredObjectRef,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.markStoredWithinTransaction(
        transaction,
        reservationId,
        object,
      );
    });
  }

  async markStoredWithinTransaction(
    transaction: Prisma.TransactionClient,
    reservationId: string,
    object: StoredObjectRef,
    now = new Date(),
  ): Promise<void> {
    // Expiry cleanup uses this same global lock before deleting an unstored
    // lease. Taking it here closes the delete-vs-mark window immediately
    // after an object has been written.
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
    `;
    await lockStorageWriteReservation(transaction, reservationId);
    const reservation = await transaction.storageWriteReservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation || reservation.sizeBytes !== object.sizeBytes) {
      throw new Error("STORAGE_WRITE_RESERVATION_MISMATCH");
    }
    if (
      reservation.storageBucket &&
      (reservation.storageBucket !== object.bucket ||
        reservation.storageKey !== object.key ||
        reservation.checksumSha256 !== object.checksumSha256)
    ) {
      throw new Error("STORAGE_WRITE_RESERVATION_MISMATCH");
    }
    const marked = await transaction.storageWriteReservation.updateMany({
      where: { id: reservationId, objectDeletedAt: null },
      data: {
        storageBucket: object.bucket,
        storageKey: object.key,
        checksumSha256: object.checksumSha256,
        expiresAt: storageWriteReservationExpiresAt(now),
        lastError: null,
      },
    });
    if (marked.count !== 1) {
      throw new Error("STORAGE_WRITE_RESERVATION_MISMATCH");
    }
  }

  async resizeWithinTransaction(
    transaction: Prisma.TransactionClient,
    reservationId: string,
    sizeBytes: number,
    purpose: StorageWritePurpose,
    now = new Date(),
  ): Promise<boolean> {
    assertStorageReservationSize(sizeBytes);
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
    `;
    await lockStorageWriteReservation(transaction, reservationId);
    const reservation = await transaction.storageWriteReservation.findFirst({
      where: {
        id: reservationId,
        purpose,
        storageBucket: null,
        objectDeletedAt: null,
        expiresAt: { gt: now },
      },
      select: { sizeBytes: true },
    });
    if (!reservation) {
      throw new Error("STORAGE_WRITE_RESERVATION_MISMATCH");
    }
    if (reservation.sizeBytes === sizeBytes) return true;

    const usage = await readGlobalStorageUsage(transaction);
    if (
      usage.totalBytes - reservation.sizeBytes + sizeBytes >
      globalDocumentStorageLimitBytes()
    ) {
      throw new GlobalDocumentStorageQuotaError();
    }
    const resized = await transaction.storageWriteReservation.updateMany({
      where: {
        id: reservationId,
        sizeBytes: reservation.sizeBytes,
        purpose,
        storageBucket: null,
        objectDeletedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        sizeBytes,
        expiresAt: storageWriteReservationExpiresAt(now),
      },
    });
    if (resized.count !== 1) {
      throw new Error("STORAGE_WRITE_RESERVATION_MISMATCH");
    }
    return true;
  }

  async commit(
    transaction: Prisma.TransactionClient,
    reservationId: string,
  ): Promise<void> {
    await lockStorageWriteReservation(transaction, reservationId);
    const committed = await transaction.storageWriteReservation.deleteMany({
      where: { id: reservationId, storageBucket: { not: null } },
    });
    if (committed.count !== 1) {
      throw new Error("STORAGE_WRITE_RESERVATION_LOST");
    }
  }

  async cancel(reservationId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.cancelWithinTransaction(transaction, reservationId);
    });
  }

  async cancelWithinTransaction(
    transaction: Prisma.TransactionClient,
    reservationId: string,
  ): Promise<void> {
    await lockStorageWriteReservation(transaction, reservationId);
    await transaction.storageWriteReservation.deleteMany({
      where: { id: reservationId },
    });
  }
}

export async function readGlobalStorageUsage(
  transaction: Prisma.TransactionClient,
): Promise<{
  committedBytes: number;
  pendingUploadBytes: number;
  pendingReservationBytes: number;
  totalBytes: number;
}> {
  const [
    documents,
    activeRevisions,
    revisionPurgeJobs,
    packets,
    pendingUploads,
    pendingReservations,
  ] = await Promise.all([
    transaction.document.aggregate({ _sum: { sizeBytes: true } }),
    transaction.documentStorageRevision.aggregate({
      where: { deletedAt: null },
      _sum: { sizeBytes: true },
    }),
    transaction.storagePurgeJob.aggregate({
      where: { entityType: "DOCUMENT_REVISION" },
      _sum: { sizeBytes: true },
    }),
    transaction.generatedPacket.aggregate({ _sum: { sizeBytes: true } }),
    transaction.documentUploadReservation.aggregate({
      _sum: { sizeBytes: true },
    }),
    transaction.storageWriteReservation.aggregate({
      _sum: { sizeBytes: true },
    }),
  ]);
  const committedBytes =
    (documents._sum.sizeBytes ?? 0) +
    (activeRevisions._sum.sizeBytes ?? 0) +
    (revisionPurgeJobs._sum.sizeBytes ?? 0) +
    (packets._sum.sizeBytes ?? 0);
  const pendingUploadBytes = pendingUploads._sum.sizeBytes ?? 0;
  const pendingReservationBytes = pendingReservations._sum.sizeBytes ?? 0;
  return {
    committedBytes,
    pendingUploadBytes,
    pendingReservationBytes,
    // USER_UPLOAD is represented in both reservation tables. The generic
    // reservation is the single source of truth for the global byte budget;
    // DocumentUploadReservation remains an owner-count/owner-byte lease.
    totalBytes: committedBytes + pendingReservationBytes,
  };
}

export async function deleteExpiredUnstoredReservations(
  transaction: Prisma.TransactionClient,
  now: Date,
): Promise<void> {
  await transaction.storageWriteReservation.deleteMany({
    where: {
      expiresAt: { lte: now },
      storageBucket: null,
      objectDeletedAt: null,
    },
  });
}

export async function lockStorageWriteReservation(
  transaction: Pick<Prisma.TransactionClient, "$executeRaw">,
  reservationId: string,
): Promise<void> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`storage-write-reservation:${reservationId}`}))
  `;
}

export function globalDocumentStorageLimitBytes(): number {
  return readPositiveInteger(
    "DOCUMENT_STORAGE_GLOBAL_BYTES",
    100 * 1024 * 1024 * 1024,
  );
}

export function storageWriteReservationExpiresAt(now: Date): Date {
  return new Date(now.getTime() + storageWriteReservationTtlMilliseconds());
}

function storageWriteReservationTtlMilliseconds(): number {
  return (
    readBoundedPositiveInteger(
      "STORAGE_WRITE_RESERVATION_TTL_SECONDS",
      15 * 60,
      60 * 60,
    ) * 1_000
  );
}

function assertStorageReservationSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("La taille de reservation de stockage est invalide.");
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function readBoundedPositiveInteger(
  name: string,
  fallback: number,
  maximum: number,
): number {
  return Math.min(readPositiveInteger(name, fallback), maximum);
}
