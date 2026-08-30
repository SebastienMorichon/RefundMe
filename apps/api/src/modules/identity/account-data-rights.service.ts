import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import {
  lockCustomerProfile,
  lockDocumentLifecycle,
  lockGeneratedPacketCase,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";
import { readAuthenticationSecret } from "./authentication-secret";
import { NodePasswordHasher } from "./node-password-hasher.service";

export const accountExportResources = [
  "profile",
  "documents",
  "cases",
  "notifications",
  "audit",
] as const;
export type AccountExportResource = (typeof accountExportResources)[number];

@Injectable()
export class AccountDataRightsService {
  private readonly authenticationSecret = readAuthenticationSecret();

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordHasher: NodePasswordHasher,
  ) {}

  async exportPage(input: {
    userId: string;
    resource: AccountExportResource;
    cursor: string | null;
    limit: number;
  }) {
    await this.assertActiveAccount(input.userId);
    const generatedAt = new Date().toISOString();
    if (input.resource === "profile") {
      const profile = await this.prisma.user.findFirst({
        where: { id: input.userId, accountDeletedAt: null },
        select: {
          id: true,
          email: true,
          role: true,
          firstName: true,
          lastName: true,
          postalAddress: true,
          postalCode: true,
          city: true,
          country: true,
          phoneNumber: true,
          operatorCustomerReference: true,
          consentVersion: true,
          consentedAt: true,
          emailVerifiedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!profile) throw new UnauthorizedException("Session invalide.");
      return {
        format: "lydoc-account-export.v1",
        generatedAt,
        resource: input.resource,
        items: [profile],
        nextCursor: null,
      };
    }

    if (input.resource === "documents") {
      const rows = await this.prisma.document.findMany({
        where: {
          ownerId: input.userId,
          ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        },
        select: {
          id: true,
          kind: true,
          status: true,
          originalName: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          encrypted: true,
          watermarked: true,
          watermarkVersion: true,
          deletionRequestedAt: true,
          purgeAfter: true,
          deletedAt: true,
          retentionExpiresAt: true,
          uploadedAt: true,
          analyzedAt: true,
          ocrResult: {
            select: { provider: true, confidence: true, createdAt: true },
          },
          analyses: {
            select: {
              provider: true,
              schemaName: true,
              resultJson: true,
              confidence: true,
              createdAt: true,
            },
          },
        },
        orderBy: { id: "asc" },
        take: input.limit + 1,
      });
      return exportPage(generatedAt, input.resource, rows, input.limit);
    }

    if (input.resource === "cases") {
      const rows = await this.prisma.administrativeCase.findMany({
        where: {
          ownerId: input.userId,
          ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        },
        select: {
          id: true,
          gameRuleId: true,
          status: true,
          estimatedRecoverableCents: true,
          serviceFeeCents: true,
          confidence: true,
          complianceSnapshotJson: true,
          validatedAt: true,
          validationSnapshotJson: true,
          fulfillmentMode: true,
          createdAt: true,
          updatedAt: true,
          documents: {
            select: { documentId: true, purpose: true, createdAt: true },
          },
          payment: {
            select: {
              status: true,
              amountCents: true,
              currency: true,
              paidAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          postalShipment: {
            select: {
              product: true,
              status: true,
              postageCents: true,
              printingCents: true,
              totalCents: true,
              currency: true,
              trackingNumber: true,
              quotedAt: true,
              submittedAt: true,
              handedOverAt: true,
              deliveredAt: true,
              createdAt: true,
              updatedAt: true,
            },
          },
          generatedPackets: {
            select: { id: true, purgeRequestedAt: true, createdAt: true },
          },
        },
        orderBy: { id: "asc" },
        take: input.limit + 1,
      });
      return exportPage(generatedAt, input.resource, rows, input.limit);
    }

    if (input.resource === "notifications") {
      const rows = await this.prisma.notificationDelivery.findMany({
        where: {
          userId: input.userId,
          ...(input.cursor ? { id: { gt: input.cursor } } : {}),
        },
        select: {
          id: true,
          caseId: true,
          eventType: true,
          status: true,
          provider: true,
          attempts: true,
          sentAt: true,
          readAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { id: "asc" },
        take: input.limit + 1,
      });
      return exportPage(generatedAt, input.resource, rows, input.limit);
    }

    const rows = await this.prisma.auditLog.findMany({
      where: {
        actorId: input.userId,
        ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { id: "asc" },
      take: input.limit + 1,
    });
    return exportPage(generatedAt, input.resource, rows, input.limit);
  }

  async deleteAccount(input: {
    userId: string;
    currentPassword: string;
  }): Promise<{
    deleted: true;
    deletedAt: string;
    retainedLedgerCounts: {
      documents: number;
      cases: number;
      payments: number;
      generatedPackets: number;
      postalShipments: number;
    };
    documentPurgeSchedule: {
      gracePeriod: number;
      legalRetention: number;
      legalRetentionUntil: string | null;
      retained: Array<{
        documentId: string;
        basis: "PAID_OR_REFUNDED_TRANSACTION" | "POSTAL_FULFILLMENT";
        purgeAfter: string;
      }>;
    };
    packetPurgeSchedule: {
      immediate: number;
      policyRetention: number;
      retained: Array<{
        packetId: string;
        basis: "PAID_OR_REFUNDED_TRANSACTION" | "POSTAL_FULFILLMENT";
        purgeAfter: string;
      }>;
    };
  }> {
    const candidate = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        accountDeletedAt: true,
      },
    });
    const passwordMatches = await this.passwordHasher.verifyWithDummy(
      input.currentPassword,
      candidate?.passwordHash,
    );
    if (!candidate || candidate.accountDeletedAt || !passwordMatches) {
      throw new UnauthorizedException("Mot de passe actuel invalide.");
    }
    if (candidate.role === "ADMIN") {
      throw new ForbiddenException(
        "Un administrateur doit d'abord etre retrograde hors bande.",
      );
    }

    const now = new Date();
    const anonymizedEmail = this.anonymizedEmail(input.userId);
    const unusablePasswordHash = this.passwordHasher.createUnusableHash();
    return this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, input.userId);
      await transaction.$executeRaw(Prisma.sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`identity-account-delete:${input.userId}`}, 0)
        )
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT "id"
        FROM "User"
        WHERE "id" = ${input.userId}
        FOR UPDATE
      `);
      const [initialCaseIds, initialDocumentIds] = await Promise.all([
        transaction.administrativeCase.findMany({
          where: { ownerId: input.userId },
          select: { id: true },
          orderBy: { id: "asc" },
        }),
        transaction.document.findMany({
          where: { ownerId: input.userId },
          select: { id: true },
          orderBy: { id: "asc" },
        }),
      ]);
      for (const { id } of initialCaseIds) {
        await lockStripeCheckoutCase(transaction, id);
        await lockGeneratedPacketCase(transaction, id);
      }
      for (const { id } of initialDocumentIds) {
        await lockDocumentLifecycle(transaction, id);
      }
      const current = await transaction.user.findUnique({
        where: { id: input.userId },
        select: {
          id: true,
          passwordHash: true,
          role: true,
          accountDeletedAt: true,
          cases: {
            select: {
              id: true,
              complianceSnapshotJson: true,
              validationSnapshotJson: true,
              payment: { select: { status: true } },
              postalShipment: { select: { status: true } },
            },
          },
          documents: {
            select: {
              id: true,
              caseDocuments: {
                select: {
                  case: {
                    select: {
                      status: true,
                      payment: {
                        select: { status: true, paidAt: true, createdAt: true },
                      },
                      postalShipment: {
                        select: {
                          status: true,
                          submittedAt: true,
                          producedAt: true,
                          handedOverAt: true,
                          deliveredAt: true,
                          createdAt: true,
                        },
                      },
                      _count: { select: { generatedPackets: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (
        !current ||
        current.accountDeletedAt ||
        current.role !== "USER" ||
        current.passwordHash !== candidate.passwordHash
      ) {
        throw new ConflictException(
          "Le compte a change. Reconnectez-vous avant de recommencer.",
        );
      }
      const erasureBlockReason = accountErasureBlockReason(current.cases);
      if (erasureBlockReason) {
        throw new ConflictException(
          erasureBlockReason === "PAYMENT_PENDING"
            ? "Un paiement est encore ouvert. Fermez ou laissez expirer la session de paiement avant de supprimer le compte."
            : "Un envoi postal est en cours de soumission. Attendez sa reconciliation avant de supprimer le compte.",
        );
      }

      const caseIds = current.cases.map(({ id }) => id);
      const documentIds = current.documents.map(({ id }) => id);
      const legalRetentionDays = readLegalRetentionDays();
      const documentRetentionPlans = current.documents.flatMap(
        ({ id, caseDocuments }) => {
          const plans = caseDocuments.flatMap(
            ({ case: administrativeCase }) => {
              const plan = legalRetentionPlan(
                administrativeCase,
                now,
                legalRetentionDays,
              );
              return plan ? [plan] : [];
            },
          );
          const longest = plans.sort(
            (left, right) =>
              right.purgeAfter.getTime() - left.purgeAfter.getTime(),
          )[0];
          return longest ? [{ documentId: id, ...longest }] : [];
        },
      );
      const legalDocumentIds = documentRetentionPlans.map(
        ({ documentId }) => documentId,
      );
      const graceDocumentIds = documentIds.filter(
        (id) => !legalDocumentIds.includes(id),
      );
      const gracePurgeAt = addDays(now, readErasureGraceDays());
      const legalRetentionUntil = documentRetentionPlans.reduce<Date | null>(
        (latest, plan) =>
          !latest || plan.purgeAfter > latest ? plan.purgeAfter : latest,
        null,
      );
      const [payments, generatedPackets, postalShipments] = await Promise.all([
        transaction.payment.count({ where: { caseId: { in: caseIds } } }),
        transaction.generatedPacket.findMany({
          where: { caseId: { in: caseIds } },
          select: {
            id: true,
            caseId: true,
            storageBucket: true,
            storageKey: true,
            checksumSha256: true,
            sizeBytes: true,
            purgeRequestedAt: true,
            createdAt: true,
            case: {
              select: {
                status: true,
                payment: { select: { status: true } },
                postalShipment: { select: { status: true } },
                _count: { select: { generatedPackets: true } },
              },
            },
          },
        }),
        transaction.postalShipment.count({
          where: { caseId: { in: caseIds } },
        }),
      ]);

      const auditLogsToRedact = await transaction.auditLog.findMany({
        where: {
          OR: [
            { actorId: input.userId },
            { entityType: "User", entityId: input.userId },
            {
              entityType: "Document",
              entityId: { in: documentIds },
            },
            {
              entityType: "AdministrativeCase",
              entityId: { in: caseIds },
            },
          ],
        },
        select: { id: true, metadata: true },
      });
      let redactedAuditMetadataCount = 0;
      for (const auditLog of auditLogsToRedact) {
        if (auditLog.metadata === null) continue;
        await transaction.auditLog.update({
          where: { id: auditLog.id },
          data: {
            metadata: redactPersonalJson(
              auditLog.metadata,
            ) as Prisma.InputJsonValue,
          },
        });
        redactedAuditMetadataCount += 1;
      }

      for (const item of current.cases) {
        await transaction.administrativeCase.update({
          where: { id: item.id },
          data: {
            complianceSnapshotJson: redactPersonalJson(
              item.complianceSnapshotJson,
            ) as Prisma.InputJsonValue,
            validationSnapshotJson:
              item.validationSnapshotJson === null
                ? Prisma.DbNull
                : (redactPersonalJson(
                    item.validationSnapshotJson,
                  ) as Prisma.InputJsonValue),
          },
        });
      }

      const packetRetentionDays = readBoundedInteger(
        "SENSITIVE_DOCUMENT_RETENTION_DAYS",
        30,
        1,
        3_650,
      );
      const packetRetentionPlans = generatedPackets.map((packet) => ({
        packet,
        basis: legalRetentionBasis(packet.case),
        purgeAfter: addDays(packet.createdAt, packetRetentionDays),
      }));
      const packetsForImmediatePurge = packetRetentionPlans.filter(
        ({ packet, basis, purgeAfter }) =>
          Boolean(packet.purgeRequestedAt) || !basis || purgeAfter <= now,
      );
      for (const { packet } of packetsForImmediatePurge) {
        const tombstoned = await transaction.generatedPacket.updateMany({
          where: { id: packet.id, purgeRequestedAt: null },
          data: { purgeRequestedAt: now },
        });
        if (tombstoned.count !== 1 && !packet.purgeRequestedAt) {
          throw new ConflictException(
            "Le dossier a change pendant la suppression du compte.",
          );
        }
        await transaction.storagePurgeJob.upsert({
          where: {
            storageBucket_storageKey: {
              storageBucket: packet.storageBucket,
              storageKey: packet.storageKey,
            },
          },
          create: {
            groupType: "PACKET",
            groupId: packet.id,
            entityType: "GENERATED_PACKET",
            entityId: packet.id,
            storageBucket: packet.storageBucket,
            storageKey: packet.storageKey,
            checksumSha256: packet.checksumSha256,
            sizeBytes: packet.sizeBytes,
          },
          update: {
            groupType: "PACKET",
            groupId: packet.id,
            entityType: "GENERATED_PACKET",
            entityId: packet.id,
            checksumSha256: packet.checksumSha256,
            sizeBytes: packet.sizeBytes,
          },
        });
      }

      const graceDocumentsUpdated = await transaction.document.updateMany({
        where: { id: { in: graceDocumentIds } },
        data: {
          originalName: "document-redacted",
          deletionRequestedAt: now,
          deletedAt: now,
          purgeAfter: gracePurgeAt,
          retentionExpiresAt: gracePurgeAt,
        },
      });
      if (graceDocumentsUpdated.count !== graceDocumentIds.length) {
        throw new ConflictException(
          "Les documents ont change pendant la suppression du compte.",
        );
      }
      for (const plan of documentRetentionPlans) {
        const retainedDocument = await transaction.document.updateMany({
          where: { id: plan.documentId },
          data: {
            originalName: "document-redacted",
            deletionRequestedAt: now,
            deletedAt: now,
            purgeAfter: plan.purgeAfter,
            retentionExpiresAt: plan.purgeAfter,
          },
        });
        if (retainedDocument.count !== 1) {
          throw new ConflictException(
            "Les documents ont change pendant la suppression du compte.",
          );
        }
      }

      await Promise.all([
        transaction.ocrResult.deleteMany({
          where: { documentId: { in: documentIds } },
        }),
        transaction.documentAnalysis.deleteMany({
          where: { documentId: { in: documentIds } },
        }),
        transaction.notificationDelivery.updateMany({
          where: { userId: input.userId },
          data: { recipient: "deleted@deleted.invalid", errorMessage: null },
        }),
        transaction.postalShipment.updateMany({
          where: { caseId: { in: caseIds } },
          data: {
            previewUrl: null,
            proofOfDepositUrl: null,
            lastEventJson: Prisma.DbNull,
            errorMessage: null,
          },
        }),
        transaction.postalShipment.updateMany({
          where: {
            caseId: { in: caseIds },
            status: {
              in: ["DRAFT", "QUOTED", "FAILED", "CANCELLED"],
            },
          },
          data: {
            providerUid: null,
            providerRequestId: null,
            trackingNumber: null,
          },
        }),
        transaction.userSession.deleteMany({ where: { userId: input.userId } }),
        transaction.identityToken.deleteMany({
          where: { userId: input.userId },
        }),
        transaction.documentUploadReservation.deleteMany({
          where: { ownerId: input.userId },
        }),
      ]);

      const updated = await transaction.user.updateMany({
        where: {
          id: input.userId,
          passwordHash: candidate.passwordHash,
          role: "USER",
          accountDeletedAt: null,
        },
        data: {
          email: anonymizedEmail,
          passwordHash: unusablePasswordHash,
          role: "USER",
          firstName: null,
          lastName: null,
          postalAddress: null,
          postalCode: null,
          city: null,
          country: null,
          phoneNumber: null,
          operatorCustomerReference: null,
          emailVerifiedAt: null,
          mfaSecretEncrypted: null,
          mfaEnabledAt: null,
          mfaLastUsedStep: null,
          accountDeletedAt: now,
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException(
          "Le compte a change. Reconnectez-vous avant de recommencer.",
        );
      }

      const retainedLedgerCounts = {
        documents: documentIds.length,
        cases: caseIds.length,
        payments,
        generatedPackets: generatedPackets.length,
        postalShipments,
      };
      const documentPurgeSchedule = {
        gracePeriod: graceDocumentIds.length,
        legalRetention: legalDocumentIds.length,
        legalRetentionUntil: legalRetentionUntil?.toISOString() ?? null,
        retained: documentRetentionPlans.map(
          ({ documentId, basis, purgeAfter }) => ({
            documentId,
            basis,
            purgeAfter: purgeAfter.toISOString(),
          }),
        ),
      };
      const packetPurgeSchedule = {
        immediate: packetsForImmediatePurge.length,
        policyRetention:
          generatedPackets.length - packetsForImmediatePurge.length,
        retained: packetRetentionPlans.flatMap(
          ({ packet, basis, purgeAfter }) =>
            !packet.purgeRequestedAt && basis && purgeAfter > now
              ? [
                  {
                    packetId: packet.id,
                    basis,
                    purgeAfter: purgeAfter.toISOString(),
                  },
                ]
              : [],
        ),
      };
      await transaction.auditLog.create({
        data: {
          actorId: input.userId,
          action: "ACCOUNT_ERASURE_PSEUDONYMIZED_AND_PURGE_SCHEDULED",
          entityType: "User",
          entityId: input.userId,
          metadata: {
            deletedAt: now.toISOString(),
            pseudonymized: true,
            derivedDocumentDataDeleted: true,
            retainedLedgerCounts,
            documentPurgeSchedule,
            packetPurgeSchedule,
            redactedAuditMetadataCount,
            retentionBasis: "LEGAL_AND_TRANSACTIONAL_RECORDS",
          },
        },
      });
      return {
        deleted: true,
        deletedAt: now.toISOString(),
        retainedLedgerCounts,
        documentPurgeSchedule,
        packetPurgeSchedule,
      };
    });
  }

  private async assertActiveAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, accountDeletedAt: null },
      select: { id: true },
    });
    if (!user) throw new UnauthorizedException("Session invalide.");
  }

  private anonymizedEmail(userId: string): string {
    const digest = createHmac("sha256", this.authenticationSecret)
      .update("lydoc-deleted-account-email-v1\0")
      .update(userId)
      .digest("hex")
      .slice(0, 40);
    return `deleted-${digest}@deleted.invalid`;
  }
}

export function requiresLegalDocumentRetention(input: {
  status: string;
  payment: { status: string } | null;
  postalShipment: { status: string } | null;
  _count: { generatedPackets: number };
}): boolean {
  return legalRetentionBasis(input) !== null;
}

export function accountErasureBlockReason(
  cases: ReadonlyArray<{
    payment?: { status: string } | null;
    postalShipment?: { status: string } | null;
  }>,
): "PAYMENT_PENDING" | "POSTAL_SUBMISSION_IN_FLIGHT" | null {
  if (cases.some(({ payment }) => payment?.status === "PENDING")) {
    return "PAYMENT_PENDING";
  }
  if (
    cases.some(({ postalShipment }) => postalShipment?.status === "SUBMITTING")
  ) {
    return "POSTAL_SUBMISSION_IN_FLIGHT";
  }
  return null;
}

export function legalRetentionPlan(
  input: {
    payment: {
      status: string;
      paidAt?: Date | null;
      createdAt?: Date | null;
    } | null;
    postalShipment: {
      status: string;
      submittedAt?: Date | null;
      producedAt?: Date | null;
      handedOverAt?: Date | null;
      deliveredAt?: Date | null;
      createdAt?: Date | null;
    } | null;
  },
  now: Date,
  retentionDays: number,
): {
  basis: "PAID_OR_REFUNDED_TRANSACTION" | "POSTAL_FULFILLMENT";
  purgeAfter: Date;
} | null {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error("Legal retention duration is invalid.");
  }
  const candidates: Array<{
    basis: "PAID_OR_REFUNDED_TRANSACTION" | "POSTAL_FULFILLMENT";
    purgeAfter: Date;
  }> = [];
  if (input.payment && ["PAID", "REFUNDED"].includes(input.payment.status)) {
    candidates.push({
      basis: "PAID_OR_REFUNDED_TRANSACTION",
      purgeAfter: addDays(
        input.payment.paidAt ?? input.payment.createdAt ?? now,
        retentionDays,
      ),
    });
  }
  if (
    input.postalShipment &&
    [
      "SUBMITTED",
      "PRODUCED",
      "HANDED_OVER",
      "IN_TRANSIT",
      "DELIVERED",
    ].includes(input.postalShipment.status)
  ) {
    candidates.push({
      basis: "POSTAL_FULFILLMENT",
      purgeAfter: addDays(
        input.postalShipment.submittedAt ??
          input.postalShipment.producedAt ??
          input.postalShipment.handedOverAt ??
          input.postalShipment.deliveredAt ??
          input.postalShipment.createdAt ??
          now,
        retentionDays,
      ),
    });
  }
  return (
    candidates
      .filter(({ purgeAfter }) => purgeAfter > now)
      .sort(
        (left, right) => right.purgeAfter.getTime() - left.purgeAfter.getTime(),
      )[0] ?? null
  );
}

function legalRetentionBasis(input: {
  payment: { status: string } | null;
  postalShipment: { status: string } | null;
}): "PAID_OR_REFUNDED_TRANSACTION" | "POSTAL_FULFILLMENT" | null {
  if (input.payment && ["PAID", "REFUNDED"].includes(input.payment.status)) {
    return "PAID_OR_REFUNDED_TRANSACTION";
  }
  if (
    input.postalShipment &&
    [
      "SUBMITTED",
      "PRODUCED",
      "HANDED_OVER",
      "IN_TRANSIT",
      "DELIVERED",
    ].includes(input.postalShipment.status)
  ) {
    return "POSTAL_FULFILLMENT";
  }
  return null;
}

function readErasureGraceDays(): number {
  return readBoundedInteger("ACCOUNT_ERASURE_PURGE_GRACE_DAYS", 7, 0, 30);
}

function readLegalRetentionDays(): number {
  const raw = Number(process.env.ACCOUNT_LEGAL_RECORD_RETENTION_DAYS);
  if (Number.isInteger(raw) && raw >= 365 && raw <= 4_000) return raw;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ACCOUNT_LEGAL_RECORD_RETENTION_DAYS must be between 365 and 4000.",
    );
  }
  return 3_650;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1_000);
}

function readBoundedInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function exportPage<T extends { id: string }>(
  generatedAt: string,
  resource: AccountExportResource,
  rows: T[],
  limit: number,
) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    format: "lydoc-account-export.v1",
    generatedAt,
    resource,
    items,
    nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
  };
}

const personalJsonKeys = new Set([
  "email",
  "firstname",
  "lastname",
  "postaladdress",
  "postalcode",
  "city",
  "country",
  "phonenumber",
  "operatorcustomerreference",
  "ownerid",
  "originalname",
  "filename",
  "customeremail",
  "accountnumber",
  "accountholder",
  "iban",
  "bic",
  "address",
  "recipient",
  "evidence",
  "label",
  "occurredon",
]);

export function redactPersonalJson(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map((item) => redactPersonalJson(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      personalJsonKeys.has(key.toLowerCase())
        ? typeof nested === "string"
          ? ""
          : null
        : redactPersonalJson(nested),
    ]),
  );
}
