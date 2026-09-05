import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { DocumentKind, Prisma } from "@prisma/client";
import {
  LocalEncryptedObjectStorageProvider,
  PdfImageDocumentWatermarkProvider,
} from "@lydoc/infrastructure";
import { PrismaService } from "../prisma/prisma.service";
import {
  lockDocumentLifecycle,
  lockGeneratedPacketCase,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";
import {
  deleteExpiredUnstoredReservations,
  lockStorageWriteReservation,
  StorageWriteReservations,
} from "../../platform/storage-write-reservations";

const sensitiveKinds = [
  DocumentKind.IDENTITY_DOCUMENT,
  DocumentKind.BANK_DETAILS,
] as const;
const lockedCaseStatuses = new Set([
  "PAID",
  "GENERATED",
  "PRINT_READY",
  "SENT",
  "REFUNDED",
  "REJECTED",
  "CANCELLED",
]);
const lockedShipmentStatuses = new Set([
  "SUBMITTING",
  "SUBMITTED",
  "PRODUCED",
  "HANDED_OVER",
  "IN_TRANSIT",
  "DELIVERED",
]);

@Injectable()
export class DocumentLifecycleService implements OnModuleInit, OnModuleDestroy {
  private retentionTimer: NodeJS.Timeout | undefined;
  private automaticRetentionRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
    private readonly watermarker: PdfImageDocumentWatermarkProvider,
    private readonly storageReservations: StorageWriteReservations = new StorageWriteReservations(
      prisma,
    ),
  ) {}

  onModuleInit(): void {
    if (!automaticRetentionEnabled(process.env)) return;
    void this.runAutomaticRetention("startup");
    this.retentionTimer = setInterval(
      () => void this.runAutomaticRetention("interval"),
      retentionIntervalMilliseconds(process.env),
    );
    this.retentionTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = undefined;
  }

  async requestDeletion(documentId: string, ownerId: string) {
    const initialDocument = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId, deletedAt: null },
      select: { caseDocuments: { select: { caseId: true } } },
    });
    if (!initialDocument) throw new NotFoundException("Document introuvable.");

    const now = new Date();
    const purgeAfter = addDays(
      now,
      readPositiveInteger("DOCUMENT_DELETION_GRACE_DAYS", 7),
    );
    const initiallyKnownCaseIds = uniqueSortedIds(
      initialDocument.caseDocuments.map(({ caseId }) => caseId),
    );
    const outcome = await this.prisma.$transaction(async (transaction) => {
      const lockedCaseIds = new Set<string>();
      await lockDocumentCases(
        transaction,
        initiallyKnownCaseIds,
        lockedCaseIds,
      );
      await lockDocumentLifecycle(transaction, documentId);

      const document = await findDeletionCandidate(
        transaction,
        documentId,
        ownerId,
      );
      if (!document) return { state: "NOT_FOUND" as const };

      // Never acquire a newly discovered case lock while holding the document
      // lock: attachment uses case -> document and that reversal can deadlock.
      // Reject this stale attempt; a retry will discover and pre-lock the case.
      const newlyAttachedCaseIds = uniqueSortedIds(
        document.caseDocuments
          .map(({ caseId }) => caseId)
          .filter((caseId) => !lockedCaseIds.has(caseId)),
      );
      if (newlyAttachedCaseIds.length > 0) {
        return { state: "RETRY" as const };
      }

      const blockers = document.caseDocuments.flatMap(
        ({ caseId, case: item }) => {
          const reason = documentDeletionBlockReason({
            status: item.status,
            paymentStatus: item.payment?.status ?? null,
            generatedPacketCount: item._count.generatedPackets,
            postalShipmentStatus: item.postalShipment?.status ?? null,
          });
          return reason ? [{ caseId, status: item.status, reason }] : [];
        },
      );
      if (blockers.length > 0) {
        await transaction.auditLog.create({
          data: {
            actorId: ownerId,
            action: "DOCUMENT_DELETION_BLOCKED",
            entityType: "Document",
            entityId: documentId,
            metadata: { cases: blockers },
          },
        });
        return { state: "BLOCKED" as const };
      }

      const affectedCaseIds = uniqueSortedIds(
        document.caseDocuments.map(({ caseId }) => caseId),
      );
      const tombstoned = await transaction.document.updateMany({
        where: { id: documentId, ownerId, deletedAt: null },
        data: { deletionRequestedAt: now, deletedAt: now, purgeAfter },
      });
      if (tombstoned.count !== 1) {
        return { state: "NOT_FOUND" as const };
      }
      if (affectedCaseIds.length > 0) {
        const updatedCases = await transaction.administrativeCase.updateMany({
          where: {
            id: { in: affectedCaseIds },
            status: {
              in: ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"],
            },
            generatedPackets: { none: {} },
            AND: [
              {
                OR: [
                  { payment: { is: null } },
                  { payment: { is: { status: "FAILED" } } },
                ],
              },
              {
                OR: [
                  { postalShipment: { is: null } },
                  {
                    postalShipment: {
                      is: {
                        status: {
                          in: ["DRAFT", "QUOTED", "FAILED", "CANCELLED"],
                        },
                      },
                    },
                  },
                ],
              },
            ],
          },
          data: {
            status: "WAITING_FOR_USER_DOCUMENTS",
            validatedAt: null,
            validationSnapshotJson: Prisma.DbNull,
          },
        });
        if (updatedCases.count !== affectedCaseIds.length) {
          throw new Error("DOCUMENT_CASE_STATE_CHANGED_DURING_DELETION");
        }
      }
      await transaction.caseDocument.deleteMany({ where: { documentId } });
      await transaction.ocrResult.deleteMany({ where: { documentId } });
      await transaction.documentAnalysis.deleteMany({
        where: { documentId },
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "DOCUMENT_DELETION_REQUESTED",
          entityType: "Document",
          entityId: documentId,
          metadata: { purgeAfter: purgeAfter.toISOString(), affectedCaseIds },
        },
      });
      return {
        state: "DELETED" as const,
        affectedCaseIds,
      };
    });

    if (outcome.state === "NOT_FOUND") {
      throw new NotFoundException("Document introuvable.");
    }
    if (outcome.state === "RETRY") {
      throw new BadRequestException(
        "Le document vient d'etre rattache a un dossier. Rechargez la page avant de renouveler la suppression.",
      );
    }
    if (outcome.state === "BLOCKED") {
      throw new BadRequestException(
        "Ce document appartient à un dossier finalisé ou à un paiement en cours. Contactez le support pour exercer une demande d'effacement encadrée.",
      );
    }

    return { documentId, deletedAt: now, purgeAfter };
  }

  async migrateSensitiveDocuments(input: {
    actorId: string;
    dryRun: boolean;
    limit: number;
  }) {
    const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
    const candidates = await this.prisma.document.findMany({
      where: {
        kind: { in: [...sensitiveKinds] },
        deletedAt: null,
        ownerId: { not: null },
        watermarked: false,
      },
      select: {
        id: true,
        ownerId: true,
        kind: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        storageBucket: true,
        storageKey: true,
        checksumSha256: true,
        watermarked: true,
      },
      orderBy: { uploadedAt: "asc" },
      take: limit,
    });

    if (input.dryRun) {
      return {
        dryRun: true,
        candidates: candidates.map((document) => ({
          id: document.id,
          kind: document.kind,
          originalName: document.originalName,
          sizeBytes: document.sizeBytes,
          action: "WATERMARK",
        })),
      };
    }

    const results: Array<Record<string, unknown>> = [];
    for (const document of candidates) {
      if (!document.ownerId) continue;
      try {
        const bytes = await this.storage.getDecryptedObject({
          object: {
            bucket: document.storageBucket,
            key: document.storageKey,
            checksumSha256: document.checksumSha256,
            sizeBytes: document.sizeBytes,
          },
          encryptionContext: {
            ownerId: document.ownerId,
            documentKind: document.kind,
          },
        });
        const watermarked = await this.watermarker.watermark({
          bytes,
          mimeType: document.mimeType,
          kind: document.kind,
        });
        const storageReservationId = await this.storageReservations.reserve(
          watermarked.bytes.byteLength,
          "DOCUMENT_REVISION",
        );
        let replacement: Awaited<
          ReturnType<LocalEncryptedObjectStorageProvider["putEncryptedObject"]>
        > | null = null;
        try {
          replacement = await this.storage.putEncryptedObject({
            bytes: watermarked.bytes,
            originalName: document.originalName,
            mimeType: document.mimeType,
            encryptionContext: {
              ownerId: document.ownerId,
              documentKind: document.kind,
            },
          });
          if (replacement.sizeBytes !== watermarked.bytes.byteLength) {
            throw new Error("DOCUMENT_REVISION_STORAGE_SIZE_MISMATCH");
          }
          const storedReplacement = replacement;
          await this.storageReservations.markStored(
            storageReservationId,
            storedReplacement,
          );
          const revisionExpiresAt = addDays(
            new Date(),
            readPositiveInteger("DOCUMENT_MIGRATION_BACKUP_DAYS", 7),
          );
          await this.prisma.$transaction(async (transaction) => {
            await lockDocumentLifecycle(transaction, document.id);
            const current = await transaction.document.findFirst({
              where: {
                id: document.id,
                ownerId: document.ownerId,
                deletedAt: null,
                watermarked: false,
                storageBucket: document.storageBucket,
                storageKey: document.storageKey,
                checksumSha256: document.checksumSha256,
                sizeBytes: document.sizeBytes,
              },
              select: { id: true },
            });
            if (!current) {
              throw new Error("DOCUMENT_CHANGED_DURING_WATERMARK_MIGRATION");
            }
            await transaction.documentStorageRevision.create({
              data: {
                documentId: document.id,
                storageBucket: document.storageBucket,
                storageKey: document.storageKey,
                checksumSha256: document.checksumSha256,
                sizeBytes: document.sizeBytes,
                reason: "WATERMARK_MIGRATION",
                expiresAt: revisionExpiresAt,
              },
            });
            const replaced = await transaction.document.updateMany({
              where: {
                id: document.id,
                ownerId: document.ownerId,
                deletedAt: null,
                watermarked: false,
                storageBucket: document.storageBucket,
                storageKey: document.storageKey,
                checksumSha256: document.checksumSha256,
                sizeBytes: document.sizeBytes,
              },
              data: {
                storageBucket: storedReplacement.bucket,
                storageKey: storedReplacement.key,
                checksumSha256: storedReplacement.checksumSha256,
                sizeBytes: storedReplacement.sizeBytes,
                watermarked: true,
                watermarkVersion: watermarked.version,
                watermarkReference: watermarked.reference,
                watermarkedAt: watermarked.watermarkedAt,
              },
            });
            if (replaced.count !== 1) {
              throw new Error("DOCUMENT_CHANGED_DURING_WATERMARK_MIGRATION");
            }
            await this.storageReservations.commit(
              transaction,
              storageReservationId,
            );
            await transaction.auditLog.create({
              data: {
                actorId: input.actorId,
                action: "SENSITIVE_DOCUMENT_WATERMARK_MIGRATED",
                entityType: "Document",
                entityId: document.id,
                metadata: {
                  backupExpiresAt: revisionExpiresAt.toISOString(),
                  watermarkVersion: watermarked.version,
                },
              },
            });
          });
        } catch (error) {
          await this.cleanupUncommittedStorageWrite(
            storageReservationId,
            replacement,
          );
          throw error;
        }

        results.push({
          id: document.id,
          status: "MIGRATED",
        });
      } catch (error) {
        results.push({
          id: document.id,
          status: "FAILED",
          error: safeLifecycleError(error),
        });
      }
    }

    return { dryRun: false, results };
  }

  async runRetention(input: { actorId: string | null; dryRun: boolean }) {
    const staged = await this.prisma.$transaction(
      async (transaction) => {
        const [lock] = await transaction.$queryRaw<
          Array<{ acquired: boolean }>
        >`
          SELECT pg_try_advisory_xact_lock(1280916044, 1) AS "acquired"
        `;
        if (!lock?.acquired) {
          return emptyRetentionResult(input.dryRun, "LOCK_NOT_ACQUIRED");
        }
        return this.executeRetention(transaction, input);
      },
      { maxWait: 5_000, timeout: 300_000 },
    );
    if (input.dryRun || staged.skipped) return staged;

    // Storage I/O starts only after every tombstone/outbox row above committed.
    const purged = await this.processStoragePurgeJobs(input.actorId);
    const orphanStorageResults =
      await this.processExpiredStorageWriteReservations(input.actorId);
    return {
      ...staged,
      revisionResults: purged.revisionResults,
      generatedPacketResults: purged.generatedPacketResults,
      documentResults: purged.documentResults,
      orphanStorageResults,
    };
  }

  private async executeRetention(
    transaction: Prisma.TransactionClient,
    input: { actorId: string | null; dryRun: boolean },
  ) {
    const now = new Date();
    const generatedPacketCutoff = addDays(
      now,
      -readPositiveInteger("SENSITIVE_DOCUMENT_RETENTION_DAYS", 30),
    );
    const expiringDocuments = await transaction.document.findMany({
      where: {
        ownerId: { not: null },
        deletedAt: null,
        retentionExpiresAt: { lte: now },
        gameRules: { none: {} },
        OR: [
          { caseDocuments: { none: {} } },
          { kind: { in: [...sensitiveKinds] } },
        ],
      },
      select: {
        id: true,
        kind: true,
        caseDocuments: {
          select: {
            caseId: true,
            case: {
              select: {
                status: true,
                payment: { select: { status: true } },
                postalShipment: { select: { status: true } },
                _count: { select: { generatedPackets: true } },
              },
            },
          },
        },
      },
      take: 200,
    });
    const expiredDerivedDocuments = await transaction.document.findMany({
      where: {
        ownerId: { not: null },
        retentionExpiresAt: { lte: now },
        gameRules: { none: {} },
        OR: [{ ocrResult: { isNot: null } }, { analyses: { some: {} } }],
      },
      select: {
        id: true,
        kind: true,
        caseDocuments: { select: { caseId: true } },
      },
      take: 200,
    });
    const revisions = await transaction.documentStorageRevision.findMany({
      where: { expiresAt: { lte: now }, deletedAt: null },
      take: 200,
    });
    const documents = await transaction.document.findMany({
      where: { deletedAt: { not: null }, purgeAfter: { lte: now } },
      include: {
        storageRevisions: true,
        caseDocuments: { select: { caseId: true } },
      },
      take: 100,
    });
    const generatedPackets = await transaction.generatedPacket.findMany({
      where: {
        createdAt: { lte: generatedPacketCutoff },
        purgeRequestedAt: null,
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    if (input.dryRun) {
      return {
        dryRun: true,
        skipped: null,
        expiredRevisionIds: revisions.map(({ id }) => id),
        purgeableDocumentIds: documents.map(({ id }) => id),
        expiringDocumentIds: expiringDocuments.map(({ id }) => id),
        expiredDerivedDocumentIds: expiredDerivedDocuments.map(({ id }) => id),
        expiredGeneratedPacketIds: generatedPackets.map(({ id }) => id),
      };
    }

    // Acquire every case lock before every document lock. This preserves the
    // same global order as profile updates, attachment and user deletion, even
    // when one retention batch spans several cases and documents.
    const lockedCaseIds = new Set<string>();
    await lockDocumentCases(
      transaction,
      uniqueSortedIds([
        ...expiringDocuments.flatMap(({ caseDocuments }) =>
          (caseDocuments ?? []).map(({ caseId }) => caseId),
        ),
        ...expiredDerivedDocuments.flatMap(({ caseDocuments }) =>
          (caseDocuments ?? []).map(({ caseId }) => caseId),
        ),
        ...generatedPackets.map(({ caseId }) => caseId),
        ...documents.flatMap(({ caseDocuments }) =>
          (caseDocuments ?? []).map(({ caseId }) => caseId),
        ),
      ]),
      lockedCaseIds,
    );
    for (const documentId of uniqueSortedIds([
      ...expiringDocuments.map(({ id }) => id),
      ...expiredDerivedDocuments.map(({ id }) => id),
      ...documents.map(({ id }) => id),
      ...revisions.map(({ documentId }) => documentId),
    ])) {
      await lockDocumentLifecycle(transaction, documentId);
    }

    const derivedDataResults: Array<Record<string, unknown>> = [];
    for (const document of expiredDerivedDocuments) {
      const current = await transaction.document.findFirst({
        where: {
          id: document.id,
          ownerId: { not: null },
          retentionExpiresAt: { lte: now },
          gameRules: { none: {} },
          OR: [{ ocrResult: { isNot: null } }, { analyses: { some: {} } }],
        },
        select: { id: true, kind: true },
      });
      if (!current) {
        derivedDataResults.push({ id: document.id, status: "SKIPPED" });
        continue;
      }
      const [ocrResult, analyses] = await Promise.all([
        transaction.ocrResult.deleteMany({
          where: { documentId: document.id },
        }),
        transaction.documentAnalysis.deleteMany({
          where: { documentId: document.id },
        }),
      ]);
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "DOCUMENT_DERIVED_DATA_RETENTION_PURGED",
          entityType: "Document",
          entityId: document.id,
          metadata: {
            kind: current.kind,
            ocrResultCount: ocrResult.count,
            analysisCount: analyses.count,
          },
        },
      });
      derivedDataResults.push({
        id: document.id,
        status: "PURGED",
        ocrResultCount: ocrResult.count,
        analysisCount: analyses.count,
      });
    }

    const expirationResults: Array<Record<string, unknown>> = [];
    const purgeAfter = addDays(
      now,
      readPositiveInteger("DOCUMENT_DELETION_GRACE_DAYS", 7),
    );
    for (const document of expiringDocuments) {
      const current = await transaction.document.findFirst({
        where: {
          id: document.id,
          ownerId: { not: null },
          deletedAt: null,
          retentionExpiresAt: { lte: now },
          gameRules: { none: {} },
          OR: [
            { caseDocuments: { none: {} } },
            { kind: { in: [...sensitiveKinds] } },
          ],
        },
        select: {
          id: true,
          kind: true,
          caseDocuments: {
            select: {
              caseId: true,
              case: {
                select: {
                  status: true,
                  payment: { select: { status: true } },
                  postalShipment: { select: { status: true } },
                  _count: { select: { generatedPackets: true } },
                },
              },
            },
          },
        },
      });
      if (!current) {
        expirationResults.push({ id: document.id, status: "SKIPPED" });
        continue;
      }
      const newlyAttachedCaseIds = uniqueSortedIds(
        current.caseDocuments
          .map(({ caseId }) => caseId)
          .filter((caseId) => !lockedCaseIds.has(caseId)),
      );
      if (newlyAttachedCaseIds.length > 0) {
        // Do not acquire a case lock while holding document locks: attachment
        // acquires them in the opposite (canonical) order. The next retention
        // pass will observe and pre-lock these newly committed attachments.
        expirationResults.push({
          id: current.id,
          status: "DEFERRED",
          reason: "NEW_CASE_ATTACHMENT",
          caseIds: newlyAttachedCaseIds,
        });
        continue;
      }
      const blockers = current.caseDocuments.flatMap(
        ({ caseId, case: administrativeCase }) => {
          const reason = retentionExpirationBlockReason({
            paymentStatus: administrativeCase.payment?.status ?? null,
            postalShipmentStatus:
              administrativeCase.postalShipment?.status ?? null,
          });
          return reason ? [{ caseId, reason }] : [];
        },
      );
      if (blockers.length > 0) {
        await transaction.auditLog.create({
          data: {
            actorId: input.actorId,
            action: "DOCUMENT_RETENTION_DEFERRED",
            entityType: "Document",
            entityId: current.id,
            metadata: { blockers },
          },
        });
        expirationResults.push({
          id: current.id,
          status: "DEFERRED",
          blockers,
        });
        continue;
      }
      const affectedCaseIds = current.caseDocuments.map(({ caseId }) => caseId);
      const editableCaseIds = current.caseDocuments
        .filter(({ case: administrativeCase }) =>
          canReturnCaseToDocumentCollection(administrativeCase.status),
        )
        .map(({ caseId }) => caseId);
      const tombstoned = await transaction.document.updateMany({
        where: {
          id: current.id,
          deletedAt: null,
          retentionExpiresAt: { lte: now },
        },
        data: {
          deletionRequestedAt: now,
          deletedAt: now,
          purgeAfter,
        },
      });
      if (tombstoned.count !== 1) {
        expirationResults.push({ id: current.id, status: "SKIPPED" });
        continue;
      }
      await transaction.caseDocument.deleteMany({
        where: { documentId: current.id },
      });
      if (editableCaseIds.length > 0) {
        await transaction.administrativeCase.updateMany({
          where: { id: { in: editableCaseIds } },
          data: {
            status: "WAITING_FOR_USER_DOCUMENTS",
            validatedAt: null,
            validationSnapshotJson: Prisma.DbNull,
          },
        });
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "DOCUMENT_RETENTION_EXPIRED",
          entityType: "Document",
          entityId: current.id,
          metadata: {
            kind: current.kind,
            purgeAfter: purgeAfter.toISOString(),
            affectedCaseIds,
          },
        },
      });
      expirationResults.push({ id: current.id, status: "SCHEDULED" });
    }

    const revisionResults: Array<Record<string, unknown>> = [];
    for (const revision of revisions) {
      try {
        const tombstoned = await transaction.documentStorageRevision.updateMany(
          {
            where: { id: revision.id, deletedAt: null },
            data: { deletedAt: now },
          },
        );
        if (tombstoned.count !== 1) {
          revisionResults.push({
            id: revision.id,
            status: "ALREADY_SCHEDULED",
          });
          continue;
        }
        await upsertStoragePurgeJob(transaction, {
          groupType: "REVISION",
          groupId: revision.id,
          entityType: "DOCUMENT_REVISION",
          entityId: revision.id,
          storageBucket: revision.storageBucket,
          storageKey: revision.storageKey,
          checksumSha256: revision.checksumSha256,
          sizeBytes: revision.sizeBytes,
        });
        revisionResults.push({ id: revision.id, status: "SCHEDULED" });
      } catch (error) {
        revisionResults.push({
          id: revision.id,
          status: "FAILED",
          error: safeLifecycleError(error),
        });
      }
    }

    const generatedPacketResults: Array<Record<string, unknown>> = [];
    for (const packet of generatedPackets) {
      try {
        await lockGeneratedPacketCase(transaction, packet.caseId);
        const current = await transaction.generatedPacket.findUnique({
          where: { id: packet.id },
        });
        if (!current || current.purgeRequestedAt) {
          generatedPacketResults.push({
            id: packet.id,
            status: "ALREADY_SCHEDULED",
          });
          continue;
        }
        const tombstoned = await transaction.generatedPacket.updateMany({
          where: { id: current.id, purgeRequestedAt: null },
          data: { purgeRequestedAt: now },
        });
        if (tombstoned.count !== 1) {
          generatedPacketResults.push({
            id: current.id,
            status: "ALREADY_SCHEDULED",
          });
          continue;
        }
        await upsertStoragePurgeJob(transaction, {
          groupType: "PACKET",
          groupId: current.id,
          entityType: "GENERATED_PACKET",
          entityId: current.id,
          storageBucket: current.storageBucket,
          storageKey: current.storageKey,
          checksumSha256: current.checksumSha256,
          sizeBytes: current.sizeBytes,
        });
        generatedPacketResults.push({ id: current.id, status: "SCHEDULED" });
      } catch (error) {
        generatedPacketResults.push({
          id: packet.id,
          status: "FAILED",
          error: safeLifecycleError(error),
        });
      }
    }

    const documentResults: Array<Record<string, unknown>> = [];
    for (const document of documents) {
      try {
        const current = await transaction.document.findFirst({
          where: {
            id: document.id,
            deletedAt: { not: null },
            purgeAfter: { lte: now },
          },
          include: {
            // Include already tombstoned revisions too: a failed prior
            // revision purge must be regrouped with the document so the
            // document row cannot cascade-delete its last blob reference.
            storageRevisions: true,
            caseDocuments: { select: { caseId: true } },
          },
        });
        if (!current) {
          documentResults.push({ id: document.id, status: "SKIPPED" });
          continue;
        }
        await upsertStoragePurgeJob(transaction, {
          groupType: "DOCUMENT",
          groupId: current.id,
          entityType: "DOCUMENT",
          entityId: current.id,
          storageBucket: current.storageBucket,
          storageKey: current.storageKey,
          checksumSha256: current.checksumSha256,
          sizeBytes: current.sizeBytes,
        });
        for (const revision of current.storageRevisions) {
          await transaction.documentStorageRevision.updateMany({
            where: { id: revision.id, deletedAt: null },
            data: { deletedAt: now },
          });
          await upsertStoragePurgeJob(transaction, {
            groupType: "DOCUMENT",
            groupId: current.id,
            entityType: "DOCUMENT_REVISION",
            entityId: revision.id,
            storageBucket: revision.storageBucket,
            storageKey: revision.storageKey,
            checksumSha256: revision.checksumSha256,
            sizeBytes: revision.sizeBytes,
          });
        }
        documentResults.push({ id: current.id, status: "SCHEDULED" });
      } catch (error) {
        documentResults.push({
          id: document.id,
          status: "FAILED",
          error: safeLifecycleError(error),
        });
      }
    }

    return {
      dryRun: false,
      skipped: null,
      derivedDataResults,
      expirationResults,
      revisionResults,
      generatedPacketResults,
      documentResults,
    };
  }

  private async processStoragePurgeJobs(actorId: string | null): Promise<{
    revisionResults: Array<Record<string, unknown>>;
    generatedPacketResults: Array<Record<string, unknown>>;
    documentResults: Array<Record<string, unknown>>;
  }> {
    const results = {
      revisionResults: [] as Array<Record<string, unknown>>,
      generatedPacketResults: [] as Array<Record<string, unknown>>,
      documentResults: [] as Array<Record<string, unknown>>,
    };
    const jobs = await this.prisma.storagePurgeJob.findMany({
      where: { status: { in: ["PENDING", "OBJECT_DELETED"] } },
      orderBy: { createdAt: "asc" },
      take: 500,
    });

    for (const candidate of jobs) {
      let job = candidate;
      if (job.status === "PENDING") {
        try {
          await this.storage.deleteObject({
            bucket: job.storageBucket,
            key: job.storageKey,
            checksumSha256: job.checksumSha256,
            sizeBytes: job.sizeBytes,
          });
        } catch (error) {
          if (!isMissingStorageObjectError(error)) {
            await this.prisma.storagePurgeJob.updateMany({
              where: { id: job.id, status: "PENDING" },
              data: {
                attempts: { increment: 1 },
                lastError: safeLifecycleError(error),
              },
            });
            appendStoragePurgeResult(results, job, {
              id: purgeResultEntityId(job),
              status: "FAILED",
              error: safeLifecycleError(error),
            });
            continue;
          }
        }

        const deletedAt = new Date();
        const marked = await this.prisma.storagePurgeJob.updateMany({
          where: { id: job.id, status: "PENDING" },
          data: {
            status: "OBJECT_DELETED",
            objectDeletedAt: deletedAt,
            attempts: { increment: 1 },
            lastError: null,
          },
        });
        if (marked.count !== 1) continue;
        job = { ...job, status: "OBJECT_DELETED", objectDeletedAt: deletedAt };
      }

      const finalized = await this.finalizeStoragePurgeJob(job.id, actorId);
      if (finalized) appendStoragePurgeResult(results, job, finalized);
    }
    return results;
  }

  private async finalizeStoragePurgeJob(
    jobId: string,
    actorId: string | null,
  ): Promise<Record<string, unknown> | null> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`storage-purge-job:${jobId}`}))
      `;
      const job = await transaction.storagePurgeJob.findUnique({
        where: { id: jobId },
      });
      if (!job || job.status !== "OBJECT_DELETED") return null;
      const unfinished = await transaction.storagePurgeJob.count({
        where: {
          groupType: job.groupType,
          groupId: job.groupId,
          status: "PENDING",
        },
      });
      if (unfinished > 0) return null;

      if (job.groupType === "REVISION") {
        await transaction.documentStorageRevision.updateMany({
          where: { id: job.groupId },
          data: { deletedAt: job.objectDeletedAt ?? new Date() },
        });
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "DOCUMENT_STORAGE_REVISION_PHYSICALLY_PURGED",
            entityType: "DocumentStorageRevision",
            entityId: job.groupId,
          },
        });
        await transaction.storagePurgeJob.deleteMany({
          where: { groupType: job.groupType, groupId: job.groupId },
        });
        return { id: job.groupId, status: "PURGED" };
      }

      if (job.groupType === "PACKET") {
        let packet = await transaction.generatedPacket.findUnique({
          where: { id: job.groupId },
        });
        if (packet) {
          await lockGeneratedPacketCase(transaction, packet.caseId);
          packet = await transaction.generatedPacket.findUnique({
            where: { id: job.groupId },
          });
        }
        if (packet?.purgeRequestedAt) {
          const [ocrResult, analyses] = await Promise.all([
            transaction.ocrResult.deleteMany({
              where: {
                document: {
                  caseDocuments: { some: { caseId: packet.caseId } },
                },
              },
            }),
            transaction.documentAnalysis.deleteMany({
              where: {
                document: {
                  caseDocuments: { some: { caseId: packet.caseId } },
                },
              },
            }),
          ]);
          await transaction.generatedPacket.deleteMany({
            where: { id: packet.id, purgeRequestedAt: { not: null } },
          });
          await transaction.auditLog.create({
            data: {
              actorId,
              action: "GENERATED_PACKET_PHYSICALLY_PURGED",
              entityType: "GeneratedPacket",
              entityId: packet.id,
              metadata: {
                caseId: packet.caseId,
                ocrResultCount: ocrResult.count,
                analysisCount: analyses.count,
              },
            },
          });
        }
        await transaction.storagePurgeJob.deleteMany({
          where: { groupType: job.groupType, groupId: job.groupId },
        });
        return { id: job.groupId, status: "PURGED" };
      }

      if (job.groupType === "DOCUMENT") {
        const initialDocument = await transaction.document.findUnique({
          where: { id: job.groupId },
          select: {
            caseDocuments: { select: { caseId: true } },
          },
        });
        await lockDocumentCases(
          transaction,
          uniqueSortedIds(
            initialDocument?.caseDocuments.map(({ caseId }) => caseId) ?? [],
          ),
          new Set<string>(),
        );
        await lockDocumentLifecycle(transaction, job.groupId);
        const document = await transaction.document.findUnique({
          where: { id: job.groupId },
          select: { id: true, deletedAt: true },
        });
        if (document?.deletedAt) {
          await transaction.ocrResult.deleteMany({
            where: { documentId: document.id },
          });
          await transaction.documentAnalysis.deleteMany({
            where: { documentId: document.id },
          });
          await transaction.caseDocument.deleteMany({
            where: { documentId: document.id },
          });
          await transaction.document.deleteMany({
            where: { id: document.id, deletedAt: { not: null } },
          });
          await transaction.auditLog.create({
            data: {
              actorId,
              action: "DOCUMENT_PHYSICALLY_PURGED",
              entityType: "Document",
              entityId: document.id,
            },
          });
        }
        await transaction.storagePurgeJob.deleteMany({
          where: { groupType: job.groupType, groupId: job.groupId },
        });
        return { id: job.groupId, status: "PURGED" };
      }

      throw new Error("UNKNOWN_STORAGE_PURGE_GROUP");
    });
  }

  private async cleanupUncommittedStorageWrite(
    reservationId: string,
    stored: Awaited<
      ReturnType<LocalEncryptedObjectStorageProvider["putEncryptedObject"]>
    > | null,
  ): Promise<void> {
    if (!stored) {
      await this.storageReservations.cancel(reservationId).catch(() => undefined);
      return;
    }
    try {
      await this.storage.deleteObject(stored);
      await this.storageReservations.cancel(reservationId).catch(() => undefined);
    } catch {
      await this.storageReservations.markStored(reservationId, stored).catch(
        () => undefined,
      );
    }
  }

  private async processExpiredStorageWriteReservations(
    actorId: string | null,
  ): Promise<Array<Record<string, unknown>>> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${"document-upload:global"}))
      `;
      await deleteExpiredUnstoredReservations(transaction, new Date());
    });
    const candidates = await this.prisma.storageWriteReservation.findMany({
      where: {
        expiresAt: { lte: new Date() },
        storageBucket: { not: null },
      },
      orderBy: { expiresAt: "asc" },
      take: 100,
    });
    const results: Array<Record<string, unknown>> = [];
    for (const candidate of candidates) {
      const result = await this.prisma.$transaction(async (transaction) => {
        await lockStorageWriteReservation(transaction, candidate.id);
        const current = await transaction.storageWriteReservation.findFirst({
          where: {
            id: candidate.id,
            expiresAt: { lte: new Date() },
            storageBucket: { not: null },
            storageKey: { not: null },
            checksumSha256: { not: null },
          },
        });
        if (
          !current ||
          !current.storageBucket ||
          !current.storageKey ||
          !current.checksumSha256
        ) {
          return null;
        }
        if (!current.objectDeletedAt) {
          try {
            await this.storage.deleteObject({
              bucket: current.storageBucket,
              key: current.storageKey,
              checksumSha256: current.checksumSha256,
              sizeBytes: current.sizeBytes,
            });
          } catch (error) {
            if (!isMissingStorageObjectError(error)) {
              await transaction.storageWriteReservation.updateMany({
                where: { id: current.id, objectDeletedAt: null },
                data: {
                  attempts: { increment: 1 },
                  lastError: safeLifecycleError(error),
                },
              });
              return {
                id: current.id,
                purpose: current.purpose,
                status: "FAILED",
                error: safeLifecycleError(error),
              };
            }
          }
        }
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "ORPHAN_STORAGE_WRITE_RECONCILED",
            entityType: "StorageWriteReservation",
            entityId: current.id,
            metadata: {
              purpose: current.purpose,
              sizeBytes: current.sizeBytes,
              attempts: current.attempts + 1,
            },
          },
        });
        await transaction.storageWriteReservation.deleteMany({
          where: { id: current.id },
        });
        return {
          id: current.id,
          purpose: current.purpose,
          status: "PURGED",
        };
      });
      if (result) results.push(result);
    }
    return results;
  }

  private async runAutomaticRetention(
    trigger: "startup" | "interval",
  ): Promise<void> {
    if (this.automaticRetentionRunning) return;
    this.automaticRetentionRunning = true;
    try {
      const result = await this.runRetention({ actorId: null, dryRun: false });
      process.stdout.write(
        `${JSON.stringify({
          level: "info",
          type: "document_retention_run",
          trigger,
          skipped: result.skipped,
          timestamp: new Date().toISOString(),
        })}\n`,
      );
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          level: "error",
          type: "document_retention_failed",
          trigger,
          error: safeLifecycleError(error),
          timestamp: new Date().toISOString(),
        })}\n`,
      );
    } finally {
      this.automaticRetentionRunning = false;
    }
  }
}

export function automaticRetentionEnabled(
  environment: NodeJS.ProcessEnv,
): boolean {
  const configured =
    environment.DOCUMENT_RETENTION_AUTOMATION_ENABLED?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return environment.NODE_ENV === "production";
}

export function retentionIntervalMilliseconds(
  environment: NodeJS.ProcessEnv,
): number {
  const minutes = Number(environment.DOCUMENT_RETENTION_INTERVAL_MINUTES);
  const normalized =
    Number.isFinite(minutes) && minutes >= 1 ? Math.trunc(minutes) : 360;
  return normalized * 60_000;
}

export function canReturnCaseToDocumentCollection(status: string): boolean {
  return ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
    status,
  );
}

async function findDeletionCandidate(
  transaction: Prisma.TransactionClient,
  documentId: string,
  ownerId: string,
) {
  return transaction.document.findFirst({
    where: { id: documentId, ownerId, deletedAt: null },
    include: {
      caseDocuments: {
        select: {
          caseId: true,
          case: {
            select: {
              status: true,
              payment: { select: { status: true } },
              postalShipment: { select: { status: true } },
              _count: { select: { generatedPackets: true } },
            },
          },
        },
      },
    },
  });
}

async function lockDocumentCases(
  transaction: Prisma.TransactionClient,
  caseIds: readonly string[],
  lockedCaseIds: Set<string>,
): Promise<void> {
  for (const caseId of caseIds) {
    if (lockedCaseIds.has(caseId)) continue;
    await lockStripeCheckoutCase(transaction, caseId);
    await lockGeneratedPacketCase(transaction, caseId);
    lockedCaseIds.add(caseId);
  }
}

function uniqueSortedIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function documentDeletionBlockReason(input: {
  status: string;
  paymentStatus: string | null;
  generatedPacketCount: number;
  postalShipmentStatus: string | null;
}): string | null {
  if (input.generatedPacketCount > 0) return "PACKET_GENERATED";
  if (input.paymentStatus === "PENDING") return "PAYMENT_PENDING";
  if (input.paymentStatus === "PAID") return "PAYMENT_PAID";
  if (input.paymentStatus === "REFUNDED") return "PAYMENT_REFUNDED";
  if (lockedCaseStatuses.has(input.status)) {
    return `CASE_STATUS_${input.status}`;
  }
  if (
    input.postalShipmentStatus &&
    lockedShipmentStatuses.has(input.postalShipmentStatus)
  ) {
    return `SHIPMENT_STATUS_${input.postalShipmentStatus}`;
  }
  return null;
}

export function retentionExpirationBlockReason(input: {
  paymentStatus: string | null;
  postalShipmentStatus: string | null;
}): string | null {
  if (input.paymentStatus === "PENDING") return "PAYMENT_PENDING";
  if (input.postalShipmentStatus === "SUBMITTING") {
    return "SHIPMENT_SUBMISSION_UNCERTAIN";
  }
  return null;
}

type StoragePurgeJobInput = Readonly<{
  groupType: "DOCUMENT" | "REVISION" | "PACKET";
  groupId: string;
  entityType: "DOCUMENT" | "DOCUMENT_REVISION" | "GENERATED_PACKET";
  entityId: string;
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
  sizeBytes: number;
}>;

async function upsertStoragePurgeJob(
  transaction: Prisma.TransactionClient,
  input: StoragePurgeJobInput,
): Promise<void> {
  await transaction.storagePurgeJob.upsert({
    where: {
      storageBucket_storageKey: {
        storageBucket: input.storageBucket,
        storageKey: input.storageKey,
      },
    },
    create: input,
    update: {
      groupType: input.groupType,
      groupId: input.groupId,
      entityType: input.entityType,
      entityId: input.entityId,
      checksumSha256: input.checksumSha256,
      sizeBytes: input.sizeBytes,
    },
  });
}

type StoragePurgeJobLike = Readonly<{
  entityType: "DOCUMENT" | "DOCUMENT_REVISION" | "GENERATED_PACKET";
  entityId: string;
  groupType: string;
  groupId: string;
}>;

function purgeResultEntityId(job: StoragePurgeJobLike): string {
  return job.groupType === "DOCUMENT" ? job.groupId : job.entityId;
}

function appendStoragePurgeResult(
  results: {
    revisionResults: Array<Record<string, unknown>>;
    generatedPacketResults: Array<Record<string, unknown>>;
    documentResults: Array<Record<string, unknown>>;
  },
  job: StoragePurgeJobLike,
  result: Record<string, unknown>,
): void {
  if (job.groupType === "DOCUMENT" || job.entityType === "DOCUMENT") {
    results.documentResults.push(result);
  } else if (job.entityType === "GENERATED_PACKET") {
    results.generatedPacketResults.push(result);
  } else {
    results.revisionResults.push(result);
  }
}

function isMissingStorageObjectError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|not[ -]?found|introuvable|\b404\b/i.test(message);
}

function emptyRetentionResult(dryRun: boolean, skipped: string) {
  return dryRun
    ? {
        dryRun: true as const,
        skipped,
        expiredRevisionIds: [] as string[],
        purgeableDocumentIds: [] as string[],
        expiringDocumentIds: [] as string[],
        expiredDerivedDocumentIds: [] as string[],
        expiredGeneratedPacketIds: [] as string[],
      }
    : {
        dryRun: false as const,
        skipped,
        derivedDataResults: [] as Array<Record<string, unknown>>,
        expirationResults: [] as Array<Record<string, unknown>>,
        revisionResults: [] as Array<Record<string, unknown>>,
        generatedPacketResults: [] as Array<Record<string, unknown>>,
        documentResults: [] as Array<Record<string, unknown>>,
      };
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function safeLifecycleError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Erreur inconnue";
  if (/authenticat|chiffr|decrypt/i.test(message)) return "DECRYPTION_FAILED";
  if (/introuvable|ENOENT/i.test(message)) return "STORAGE_OBJECT_MISSING";
  return "OPERATION_FAILED";
}
