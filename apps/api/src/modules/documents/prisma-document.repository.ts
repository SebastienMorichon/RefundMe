import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  CreateDocumentInput,
  DocumentRepository,
  StoredObjectRef,
} from "@lydoc/application";
import type {
  DocumentKind,
  DocumentStatus,
  StoredDocument,
} from "@lydoc/domain";
import { PrismaService } from "../prisma/prisma.service";
import { lockCustomerProfile } from "../../platform/transaction-locks";
import {
  lockStorageWriteReservation,
  storageWriteReservationExpiresAt,
  StorageWriteReservations,
} from "../../platform/storage-write-reservations";

export { GlobalDocumentStorageQuotaError } from "../../platform/storage-write-reservations";

export class InactiveDocumentOwnerError extends Error {
  constructor() {
    super("Le compte n'est plus actif.");
    this.name = "InactiveDocumentOwnerError";
  }
}

@Injectable()
export class PrismaDocumentRepository implements DocumentRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageReservations: StorageWriteReservations = new StorageWriteReservations(
      prisma,
    ),
  ) {}

  async create(input: CreateDocumentInput): Promise<StoredDocument> {
    return this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, input.ownerId);
      await assertActiveOwner(transaction, input.ownerId);
      const document = await transaction.document.create({
        data: documentCreateData(input),
      });
      return this.toDomain(document);
    });
  }

  async createWithinOwnerLimits(
    input: CreateDocumentInput,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
    reservationId?: string,
  ): Promise<StoredDocument | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, input.ownerId);
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`document-upload:${input.ownerId}`}))
      `;
      await assertActiveOwner(transaction, input.ownerId);
      let storageWriteReservationId: string | null = null;
      if (reservationId) {
        const initialReservation =
          await transaction.documentUploadReservation.findFirst({
            where: { id: reservationId, ownerId: input.ownerId },
            select: { storageWriteReservationId: true },
          });
        if (!initialReservation) throw invalidUploadReservation();
        storageWriteReservationId =
          initialReservation.storageWriteReservationId;
        await lockStorageWriteReservation(
          transaction,
          storageWriteReservationId,
        );
        const activeReservation =
          await transaction.documentUploadReservation.findFirst({
            where: {
              id: reservationId,
              ownerId: input.ownerId,
              sizeBytes: input.sizeBytes,
              expiresAt: { gt: new Date() },
              storageWriteReservation: {
                is: {
                  id: storageWriteReservationId,
                  sizeBytes: input.sizeBytes,
                  purpose: "USER_UPLOAD",
                  storageBucket: input.storageBucket,
                  storageKey: input.storageKey,
                  checksumSha256: input.checksumSha256,
                  objectDeletedAt: null,
                },
              },
            },
            select: { id: true },
          });
        if (!activeReservation) throw invalidUploadReservation();
      }
      const usage = await transaction.document.aggregate({
        // A tombstoned row still owns an encrypted blob during the deletion
        // grace period. It must continue consuming quota until physical purge
        // removes the row, otherwise upload/delete loops can fill the disk.
        where: { ownerId: input.ownerId },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      });
      const pendingUsage =
        await transaction.documentUploadReservation.aggregate({
          where: {
            ownerId: input.ownerId,
            expiresAt: { gt: new Date() },
            ...(reservationId ? { id: { not: reservationId } } : {}),
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        });
      if (
        usage._count._all + pendingUsage._count._all + 1 >
          limits.maxDocuments ||
        (usage._sum.sizeBytes ?? 0) +
          (pendingUsage._sum.sizeBytes ?? 0) +
          input.sizeBytes >
          limits.maxStoredBytes
      ) {
        return null;
      }
      await assertActiveOwner(transaction, input.ownerId);
      const document = await transaction.document.create({
        data: documentCreateData(input),
      });
      if (storageWriteReservationId) {
        await this.storageReservations.commit(
          transaction,
          storageWriteReservationId,
        );
      }
      return this.toDomain(document);
    });
  }

  async reserveOwnerUpload(
    ownerId: string,
    sizeBytes: number,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
  ): Promise<string | null> {
    return this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`document-upload:${ownerId}`}))
      `;
      await assertActiveOwner(transaction, ownerId);
      const now = new Date();
      const [documents, pending, globalPending] = await Promise.all([
        transaction.document.aggregate({
          where: { ownerId },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        transaction.documentUploadReservation.aggregate({
          where: { ownerId, expiresAt: { gt: now } },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        transaction.documentUploadReservation.aggregate({
          where: { expiresAt: { gt: now } },
          _sum: { sizeBytes: true },
        }),
      ]);
      const globalPendingLimit = readPositiveInteger(
        "DOCUMENT_PENDING_UPLOAD_GLOBAL_BYTES",
        500 * 1024 * 1024,
      );
      if (
        documents._count._all + pending._count._all + 1 > limits.maxDocuments ||
        (documents._sum.sizeBytes ?? 0) +
          (pending._sum.sizeBytes ?? 0) +
          sizeBytes >
          limits.maxStoredBytes ||
        (globalPending._sum.sizeBytes ?? 0) + sizeBytes > globalPendingLimit
      ) {
        return null;
      }
      const storageWriteReservationId =
        await this.storageReservations.reserveWithinTransaction(
          transaction,
          sizeBytes,
          "USER_UPLOAD",
          now,
        );
      await assertActiveOwner(transaction, ownerId);
      const reservation = await transaction.documentUploadReservation.create({
        data: {
          ownerId,
          storageWriteReservationId,
          sizeBytes,
          expiresAt: storageWriteReservationExpiresAt(now),
        },
        select: { id: true },
      });
      return reservation.id;
    });
  }

  async resizeOwnerUploadReservation(
    reservationId: string,
    ownerId: string,
    sizeBytes: number,
    limits: Readonly<{ maxDocuments: number; maxStoredBytes: number }>,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
      `;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`document-upload:${ownerId}`}))
      `;
      await assertActiveOwner(transaction, ownerId);
      const now = new Date();
      const reservation = await transaction.documentUploadReservation.findFirst(
        {
          where: {
            id: reservationId,
            ownerId,
            expiresAt: { gt: now },
          },
          select: {
            sizeBytes: true,
            storageWriteReservationId: true,
          },
        },
      );
      if (!reservation) throw invalidUploadReservation();

      const [documents, pending, globalPending] = await Promise.all([
        transaction.document.aggregate({
          where: { ownerId },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        transaction.documentUploadReservation.aggregate({
          where: {
            ownerId,
            id: { not: reservationId },
            expiresAt: { gt: now },
          },
          _count: { _all: true },
          _sum: { sizeBytes: true },
        }),
        transaction.documentUploadReservation.aggregate({
          where: {
            id: { not: reservationId },
            expiresAt: { gt: now },
          },
          _sum: { sizeBytes: true },
        }),
      ]);
      const globalPendingLimit = readPositiveInteger(
        "DOCUMENT_PENDING_UPLOAD_GLOBAL_BYTES",
        500 * 1024 * 1024,
      );
      if (
        documents._count._all + pending._count._all + 1 > limits.maxDocuments ||
        (documents._sum.sizeBytes ?? 0) +
          (pending._sum.sizeBytes ?? 0) +
          sizeBytes >
          limits.maxStoredBytes ||
        (globalPending._sum.sizeBytes ?? 0) + sizeBytes > globalPendingLimit
      ) {
        return false;
      }

      const resized = await this.storageReservations.resizeWithinTransaction(
        transaction,
        reservation.storageWriteReservationId,
        sizeBytes,
        "USER_UPLOAD",
        now,
      );
      if (!resized) return false;
      const updated = await transaction.documentUploadReservation.updateMany({
        where: {
          id: reservationId,
          ownerId,
          sizeBytes: reservation.sizeBytes,
          expiresAt: { gt: now },
        },
        data: {
          sizeBytes,
          expiresAt: storageWriteReservationExpiresAt(now),
        },
      });
      if (updated.count !== 1) throw invalidUploadReservation();
      await assertActiveOwner(transaction, ownerId);
      return true;
    });
  }

  async releaseOwnerUpload(
    reservationId: string,
    ownerId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const reservation = await transaction.documentUploadReservation.findFirst(
        {
          where: { id: reservationId, ownerId },
          select: { storageWriteReservationId: true },
        },
      );
      if (!reservation) return;
      await this.storageReservations.cancelWithinTransaction(
        transaction,
        reservation.storageWriteReservationId,
      );
    });
  }

  async recordOwnerUploadStoredObject(
    reservationId: string,
    ownerId: string,
    object: StoredObjectRef,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await assertActiveOwner(transaction, ownerId);
      const reservation = await transaction.documentUploadReservation.findFirst(
        {
          where: { id: reservationId, ownerId },
          select: { storageWriteReservationId: true },
        },
      );
      if (!reservation) throw invalidUploadReservation();
      const now = new Date();
      await this.storageReservations.markStoredWithinTransaction(
        transaction,
        reservation.storageWriteReservationId,
        object,
        now,
      );
      const touched = await transaction.documentUploadReservation.updateMany({
        where: { id: reservationId, ownerId },
        data: { expiresAt: storageWriteReservationExpiresAt(now) },
      });
      if (touched.count !== 1) throw invalidUploadReservation();
      await assertActiveOwner(transaction, ownerId);
    });
  }

  async listByOwner(ownerId: string): Promise<StoredDocument[]> {
    const documents = await this.prisma.document.findMany({
      where: {
        ownerId,
        deletedAt: null,
        owner: { is: { accountDeletedAt: null } },
      },
      orderBy: { uploadedAt: "desc" },
    });

    return documents.map((document) => this.toDomain(document));
  }

  private toDomain(document: {
    id: string;
    ownerId: string | null;
    kind: DocumentKind;
    status: DocumentStatus;
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    storageBucket: string;
    storageKey: string;
    checksumSha256: string;
    encrypted: boolean;
    watermarked: boolean;
    watermarkVersion: string | null;
    watermarkReference: string | null;
    watermarkedAt: Date | null;
  }): StoredDocument {
    if (!document.encrypted) {
      throw new Error("Stored documents must be encrypted.");
    }

    const storedDocument: StoredDocument = {
      id: document.id,
      kind: document.kind,
      status: document.status,
      originalName: document.originalName,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      storageBucket: document.storageBucket,
      checksumSha256: document.checksumSha256,
      storageKey: document.storageKey,
      encrypted: true,
      watermarked: document.watermarked,
      ...(document.watermarkVersion
        ? { watermarkVersion: document.watermarkVersion }
        : {}),
      ...(document.watermarkReference
        ? { watermarkReference: document.watermarkReference }
        : {}),
      ...(document.watermarkedAt
        ? { watermarkedAt: document.watermarkedAt }
        : {}),
    };

    return document.ownerId
      ? { ...storedDocument, ownerId: document.ownerId }
      : storedDocument;
  }
}

async function assertActiveOwner(
  transaction: Prisma.TransactionClient,
  ownerId: string,
): Promise<void> {
  const owner = await transaction.user.findFirst({
    where: { id: ownerId, accountDeletedAt: null },
    select: { id: true },
  });
  if (!owner) throw new InactiveDocumentOwnerError();
}

function documentCreateData(input: CreateDocumentInput) {
  return {
    ownerId: input.ownerId,
    kind: input.kind,
    originalName: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    storageBucket: input.storageBucket,
    storageKey: input.storageKey,
    checksumSha256: input.checksumSha256,
    watermarked: input.watermarked,
    watermarkVersion: input.watermarkVersion,
    watermarkReference: input.watermarkReference,
    watermarkedAt: input.watermarkedAt,
    retentionExpiresAt: addDays(
      new Date(),
      readPositiveInteger("DOCUMENT_RETENTION_DAYS", 365),
    ),
  };
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function invalidUploadReservation(): Error {
  return new Error(
    "La reservation de stockage de cet envoi est invalide ou expiree.",
  );
}
