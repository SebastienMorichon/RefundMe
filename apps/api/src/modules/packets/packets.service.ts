import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { DocumentKind, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import {
  documentRequirementShortName,
  findMissingDocumentRequirements,
  readDocumentRequirements,
} from "../documents/document-requirements";
import {
  readCaseValidationSnapshot,
  type CaseValidationSnapshot,
} from "../eligibility/case-snapshots";
import type { PostalExpenseReimbursement } from "../rules/postal-expense-reimbursement";
import { DEFAULT_PRICING, PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  lockCustomerProfile,
  lockGeneratedPacketCase,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";
import {
  GlobalDocumentStorageQuotaError,
  StorageWriteReservations,
} from "../../platform/storage-write-reservations";

type RequiredPacketDocument = Readonly<{
  kind: string;
  label: string;
  required: boolean;
}>;
type PacketSmsCharge = Readonly<{
  label: string;
  code?: string;
  quantity: number;
  amountCents: number;
}>;
export type PacketPostalExpenseCosts = Readonly<{
  postageCents: number | null;
  printingCents: number | null;
  printingCentsPerPage: number | null;
  printingPageCount: number;
  totalCents: number | null;
}>;
export type PacketPostalExpenseClaim = NonNullable<
  CaseValidationSnapshot["postalExpenseClaim"]
> &
  Readonly<{
    calculatedCosts?: PacketPostalExpenseCosts;
  }>;
type PacketRuleConstraints = Readonly<{
  reimbursementRecipient?: string;
  reimbursementAddress?: string;
  reimbursementEmail?: string;
  reimbursementDeadline?: string;
  reimbursementMethod?: string;
  requiredLetterMentions: string[];
}>;
type PacketAttachment = Readonly<{
  name: string;
  kind: DocumentKind;
  mimeType: string;
  bytes: Uint8Array;
}>;
type GeneratedPacketReference = Readonly<{
  id: string;
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
  sizeBytes: number;
  createdAt: Date;
}>;
type LetterFlow = {
  document: PDFDocument;
  page: PDFPage;
  cursor: number;
  regular: PDFFont;
  bold: PDFFont;
  ink: ReturnType<typeof rgb>;
  grey: ReturnType<typeof rgb>;
};
export type CreateCasePacketInput = Readonly<{
  caseId: string;
  customerEmail: string;
  customerName?: string;
  customerAddress?: string;
  customerPhone?: string;
  customerOperatorReference?: string;
  organizer: string;
  gameName: string;
  estimatedRecoverableCents: number;
  serviceFeeCents: number;
  documents: string[];
  requiredDocuments?: RequiredPacketDocument[];
  ruleConstraints?: PacketRuleConstraints;
  postalExpenseClaim?: CaseValidationSnapshot["postalExpenseClaim"];
  smsCharges?: PacketSmsCharge[];
  attachments?: PacketAttachment[];
  createdAt: Date;
  paidAt: Date | null;
  preview: boolean;
  fulfillmentMode?: "SELF_SERVICE" | "MANAGED_POSTAL";
  defaultPostageCents?: number;
}>;

@Injectable()
export class PacketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
    private readonly storageReservations: StorageWriteReservations = new StorageWriteReservations(
      prisma,
    ),
    @Optional() private readonly pricing?: PricingService,
  ) {}

  async generate(caseId: string, ownerId: string) {
    return this.build(caseId, ownerId, false);
  }

  async generatePostalPacket(caseId: string, ownerId: string) {
    return this.build(caseId, ownerId, true);
  }

  private async build(caseId: string, ownerId: string, forceFinal: boolean) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: {
        id: caseId,
        ownerId,
        owner: { accountDeletedAt: null },
      },
      include: {
        owner: {
          select: {
            email: true,
            firstName: true,
            lastName: true,
            postalAddress: true,
            postalCode: true,
            city: true,
            country: true,
            phoneNumber: true,
            operatorCustomerReference: true,
          },
        },
        gameRule: { include: { organizer: true } },
        documents: {
          where: { document: { deletedAt: null } },
          orderBy: { createdAt: "asc" },
          include: {
            document: {
              select: {
                id: true,
                kind: true,
                originalName: true,
                mimeType: true,
                storageBucket: true,
                storageKey: true,
                checksumSha256: true,
                sizeBytes: true,
              },
            },
          },
        },
        payment: { select: { status: true, paidAt: true } },
        generatedPackets: {
          where: { purgeRequestedAt: null },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            id: true,
            storageBucket: true,
            storageKey: true,
            checksumSha256: true,
            sizeBytes: true,
            createdAt: true,
          },
        },
      },
    });
    if (!administrativeCase?.gameRule) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (!canGeneratePacket(administrativeCase.status)) {
      throw new BadRequestException(
        "Le dossier doit etre complet avant de generer son apercu.",
      );
    }

    const source = forceFinal
      ? ("POSTAL_PREPARATION" as const)
      : ("SELF_SERVICE_DOWNLOAD" as const);
    const persistentPacket = administrativeCase.generatedPackets[0];
    if (persistentPacket) {
      await this.assertActiveCaseAccess(caseId, ownerId);
      return this.serveGeneratedPacket({
        packet: persistentPacket,
        caseId: administrativeCase.id,
        ownerId,
        source,
      });
    }

    const validation = readCaseValidationSnapshot(
      administrativeCase.validationSnapshotJson,
    );
    if (!administrativeCase.validatedAt || !validation) {
      throw new BadRequestException(
        "Validez le recapitulatif du dossier avant de generer le PDF.",
      );
    }

    await this.assertActiveCaseAccess(caseId, ownerId);

    const requiredDocuments = readDocumentRequirements(
      validation.rule.requiredDocuments,
    );
    const validatedDocumentIds = new Set(
      validation.documents.map((document) => document.id),
    );
    const validatedDocuments = administrativeCase.documents.filter(
      ({ document }) => validatedDocumentIds.has(document.id),
    );
    const missingDocumentLabels = findMissingRequiredDocumentLabels(
      requiredDocuments,
      validatedDocuments.map(({ document }) => document.kind),
    );
    if (missingDocumentLabels.length > 0) {
      throw new BadRequestException(
        `Le dossier est incomplet. Ajoutez les pieces suivantes avant de generer le PDF : ${missingDocumentLabels.join(", ")}.`,
      );
    }

    const selfService = administrativeCase.fulfillmentMode === "SELF_SERVICE";
    const preview = !shouldGenerateFinalPacket(
      forceFinal,
      administrativeCase.fulfillmentMode,
      administrativeCase.payment?.status,
    );
    const ruleConstraints = readRuleConstraints(validation.rule.constraints);
    const smsCharges = readSmsCharges(
      administrativeCase.complianceSnapshotJson,
    );
    const pricing = await this.pricing?.get();
    if (!preview) {
      assertPacketAttachmentSizes(
        validatedDocuments.map(({ document }) => document.sizeBytes),
      );
    }
    const attachments = preview
      ? []
      : await Promise.all(
          validatedDocuments.map(({ document }) =>
            this.readAttachment(document, ownerId),
          ),
        );
    assertPacketAggregateLimits(attachments);
    const customer = validation.customer;
    const bytes = await createCasePacket({
      caseId: administrativeCase.id,
      customerEmail: customer.email,
      customerName: [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" "),
      customerAddress: [
        customer.postalAddress,
        [customer.postalCode, customer.city].filter(Boolean).join(" "),
        customer.country,
      ]
        .filter(Boolean)
        .join(", "),
      customerPhone: customer.phoneNumber,
      customerOperatorReference: customer.operatorCustomerReference,
      organizer: validation.rule.organizerName,
      gameName: validation.rule.name,
      estimatedRecoverableCents: validation.estimatedRecoverableCents,
      serviceFeeCents: selfService ? 0 : validation.serviceFeeCents,
      documents: validatedDocuments.map(
        ({ document }) => document.originalName,
      ),
      requiredDocuments,
      ruleConstraints,
      postalExpenseClaim: validation.postalExpenseClaim,
      smsCharges,
      attachments,
      createdAt: administrativeCase.createdAt,
      paidAt: administrativeCase.payment?.paidAt ?? null,
      preview,
      fulfillmentMode: selfService ? "SELF_SERVICE" : "MANAGED_POSTAL",
      ...(pricing ? { defaultPostageCents: pricing.greenLetterCents } : {}),
    });

    if (!preview) {
      const generatedPacket = await this.persistGeneratedPacket({
        caseId: administrativeCase.id,
        ownerId,
        bytes,
        source,
        expectedCaseUpdatedAt: administrativeCase.updatedAt,
      });
      const persistedBytes = await this.readGeneratedPacket(
        generatedPacket,
        ownerId,
        administrativeCase.id,
      );
      await this.assertActiveCaseAccess(caseId, ownerId);
      return { bytes: persistedBytes, preview: false };
    }

    await this.assertActiveCaseAccess(caseId, ownerId);
    return { bytes: Buffer.from(bytes), preview };
  }

  private async persistGeneratedPacket(input: {
    caseId: string;
    ownerId: string;
    bytes: Uint8Array;
    source: "SELF_SERVICE_DOWNLOAD" | "POSTAL_PREPARATION";
    expectedCaseUpdatedAt: Date;
  }): Promise<GeneratedPacketReference> {
    const existing = await this.prisma.generatedPacket.findFirst({
      where: { caseId: input.caseId, purgeRequestedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (existing) {
      try {
        const current = await this.prisma.$transaction(async (transaction) => {
          await this.lockAndAssertActiveCase(
            transaction,
            input.caseId,
            input.ownerId,
          );
          const current = await transaction.generatedPacket.findFirst({
            where: { caseId: input.caseId, purgeRequestedAt: null },
            orderBy: { createdAt: "asc" },
          });
          if (!current) {
            throw new Error("GENERATED_PACKET_RETRY_REQUIRED");
          }
          await scheduleSensitiveDocumentRetention(
            transaction,
            input.caseId,
            current.createdAt,
          );
          if (input.source === "SELF_SERVICE_DOWNLOAD") {
            await markSelfServiceCaseGenerated(transaction, input.caseId);
          }
          await transaction.auditLog.create({
            data: {
              actorId: input.ownerId,
              action:
                input.source === "SELF_SERVICE_DOWNLOAD"
                  ? "CASE_PACKET_DOWNLOADED"
                  : "CASE_PACKET_PREPARED_FOR_POSTAL",
              entityType: "AdministrativeCase",
              entityId: input.caseId,
              metadata: {
                generatedPacketId: current.id,
                firstGeneration: false,
              },
            },
          });
          return current;
        });
        return current;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "GENERATED_PACKET_RETRY_REQUIRED"
        ) {
          throw error;
        }
      }
    }

    let storageReservationId: string;
    try {
      storageReservationId = await this.storageReservations.reserve(
        input.bytes.byteLength,
        "GENERATED_PACKET",
      );
    } catch (error) {
      if (error instanceof GlobalDocumentStorageQuotaError) {
        throw new ServiceUnavailableException(
          "Le stockage documentaire est temporairement sature.",
        );
      }
      throw error;
    }
    let stored: Awaited<
      ReturnType<LocalEncryptedObjectStorageProvider["putEncryptedObject"]>
    > | null = null;
    try {
      stored = await this.storage.putEncryptedObject({
        bytes: input.bytes,
        originalName: `dossier-lydoc-${input.caseId}.pdf`,
        mimeType: "application/pdf",
        encryptionContext: generatedPacketEncryptionContext(
          input.ownerId,
          input.caseId,
        ),
      });
      if (stored.sizeBytes !== input.bytes.byteLength) {
        throw new Error("GENERATED_PACKET_STORAGE_SIZE_MISMATCH");
      }
      await this.storageReservations.markStored(storageReservationId, stored);
      const persistedPacket = await this.prisma.$transaction(
        async (transaction) => {
          await this.lockAndAssertActiveCase(
            transaction,
            input.caseId,
            input.ownerId,
          );
          let current = await transaction.generatedPacket.findFirst({
            where: { caseId: input.caseId, purgeRequestedAt: null },
            orderBy: { createdAt: "asc" },
          });
          let firstGeneration = false;
          if (!current) {
            const currentCase = await transaction.administrativeCase.findUnique(
              {
                where: { id: input.caseId },
                select: { updatedAt: true },
              },
            );
            if (
              !currentCase ||
              currentCase.updatedAt.getTime() !==
                input.expectedCaseUpdatedAt.getTime()
            ) {
              throw new BadRequestException(
                "Le dossier a change pendant la generation. Relancez la creation du PDF.",
              );
            }
            current = await transaction.generatedPacket.create({
              data: {
                caseId: input.caseId,
                storageBucket: stored!.bucket,
                storageKey: stored!.key,
                checksumSha256: stored!.checksumSha256,
                sizeBytes: stored!.sizeBytes,
              },
            });
            await this.storageReservations.commit(
              transaction,
              storageReservationId,
            );
            firstGeneration = true;
          }

          const retentionExpiresAt = await scheduleSensitiveDocumentRetention(
            transaction,
            input.caseId,
            current.createdAt,
          );
          if (input.source === "SELF_SERVICE_DOWNLOAD") {
            await markSelfServiceCaseGenerated(transaction, input.caseId);
          }
          await transaction.auditLog.create({
            data: {
              actorId: input.ownerId,
              action:
                input.source === "SELF_SERVICE_DOWNLOAD"
                  ? "CASE_PACKET_DOWNLOADED"
                  : "CASE_PACKET_PREPARED_FOR_POSTAL",
              entityType: "AdministrativeCase",
              entityId: input.caseId,
              metadata: {
                generatedPacketId: current.id,
                firstGeneration,
                sensitiveRetentionExpiresAt: retentionExpiresAt.toISOString(),
              },
            },
          });
          return current;
        },
      );
      if (
        persistedPacket.storageBucket !== stored.bucket ||
        persistedPacket.storageKey !== stored.key
      ) {
        await this.cleanupUncommittedStorageWrite(storageReservationId, stored);
        stored = null;
      }
      return persistedPacket;
    } catch (error) {
      await this.cleanupUncommittedStorageWrite(storageReservationId, stored);
      throw error;
    }
  }

  private async cleanupUncommittedStorageWrite(
    reservationId: string,
    stored: Awaited<
      ReturnType<LocalEncryptedObjectStorageProvider["putEncryptedObject"]>
    > | null,
  ): Promise<void> {
    if (!stored) {
      await this.storageReservations
        .cancel(reservationId)
        .catch(() => undefined);
      return;
    }
    try {
      await this.storage.deleteObject(stored);
      await this.storageReservations
        .cancel(reservationId)
        .catch(() => undefined);
    } catch {
      // Retain (or retry recording) the staging reference so the expiry
      // reconciler can delete the orphan idempotently.
      await this.storageReservations
        .markStored(reservationId, stored)
        .catch(() => undefined);
    }
  }

  private async serveGeneratedPacket(input: {
    packet: GeneratedPacketReference;
    caseId: string;
    ownerId: string;
    source: "SELF_SERVICE_DOWNLOAD" | "POSTAL_PREPARATION";
  }) {
    const bytes = await this.readGeneratedPacket(
      input.packet,
      input.ownerId,
      input.caseId,
    );
    await this.prisma.$transaction(async (transaction) => {
      await this.lockAndAssertActiveCase(
        transaction,
        input.caseId,
        input.ownerId,
      );
      const current = await transaction.generatedPacket.findFirst({
        where: { caseId: input.caseId, purgeRequestedAt: null },
        orderBy: { createdAt: "asc" },
      });
      if (!current || current.id !== input.packet.id) {
        throw new ServiceUnavailableException(
          "Le PDF persistant a change pendant sa lecture. Reessayez.",
        );
      }
      await scheduleSensitiveDocumentRetention(
        transaction,
        input.caseId,
        current.createdAt,
      );
      if (input.source === "SELF_SERVICE_DOWNLOAD") {
        await markSelfServiceCaseGenerated(transaction, input.caseId);
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.ownerId,
          action:
            input.source === "SELF_SERVICE_DOWNLOAD"
              ? "CASE_PACKET_DOWNLOADED"
              : "CASE_PACKET_PREPARED_FOR_POSTAL",
          entityType: "AdministrativeCase",
          entityId: input.caseId,
          metadata: {
            generatedPacketId: current.id,
            firstGeneration: false,
            servedFromPersistentStorage: true,
          },
        },
      });
    });
    return { bytes, preview: false };
  }

  private async assertActiveCaseAccess(
    caseId: string,
    ownerId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockAndAssertActiveCase(transaction, caseId, ownerId);
    });
  }

  private async lockAndAssertActiveCase(
    transaction: Prisma.TransactionClient,
    caseId: string,
    ownerId: string,
  ): Promise<void> {
    await lockCustomerProfile(transaction, ownerId);
    await lockStripeCheckoutCase(transaction, caseId);
    await lockGeneratedPacketCase(transaction, caseId);
    const activeCase = await transaction.administrativeCase.findFirst({
      where: {
        id: caseId,
        ownerId,
        owner: { accountDeletedAt: null },
      },
      select: { id: true },
    });
    if (!activeCase) {
      throw new NotFoundException("Dossier introuvable.");
    }
  }

  private async readGeneratedPacket(
    packet: GeneratedPacketReference,
    ownerId: string,
    caseId: string,
  ): Promise<Buffer> {
    try {
      const bytes = await this.storage.getDecryptedObject({
        object: {
          bucket: packet.storageBucket,
          key: packet.storageKey,
          checksumSha256: packet.checksumSha256,
          sizeBytes: packet.sizeBytes,
        },
        encryptionContext: generatedPacketEncryptionContext(ownerId, caseId),
      });
      await assertPersistedPacket(bytes, packet.checksumSha256);
      return Buffer.from(bytes);
    } catch {
      throw new ServiceUnavailableException(
        "Le PDF persistant est indisponible ou son integrite ne peut pas etre verifiee.",
      );
    }
  }

  private async readAttachment(
    document: {
      kind: DocumentKind;
      originalName: string;
      mimeType: string;
      storageBucket: string;
      storageKey: string;
      checksumSha256: string;
      sizeBytes: number;
    },
    ownerId: string,
  ): Promise<PacketAttachment> {
    let bytes: Uint8Array;
    try {
      bytes = await this.storage.getDecryptedObject({
        object: {
          bucket: document.storageBucket,
          key: document.storageKey,
          checksumSha256: document.checksumSha256,
          sizeBytes: document.sizeBytes,
        },
        encryptionContext: { ownerId, documentKind: document.kind },
      });
    } catch {
      throw new BadRequestException(
        `La piece "${document.originalName}" ne peut pas etre dechiffree. Supprimez ce dossier puis redeposez les pieces avec la cle de chiffrement actuelle.`,
      );
    }

    return {
      name: document.originalName,
      kind: document.kind,
      mimeType: document.mimeType,
      bytes,
    };
  }
}

type PacketTransaction = Prisma.TransactionClient;

const sensitivePacketDocumentKinds = [
  DocumentKind.IDENTITY_DOCUMENT,
  DocumentKind.BANK_DETAILS,
] as const;

async function scheduleSensitiveDocumentRetention(
  transaction: PacketTransaction,
  caseId: string,
  generatedAt: Date,
): Promise<Date> {
  const retentionExpiresAt = sensitivePacketRetentionDeadline(generatedAt);
  await transaction.document.updateMany({
    where: {
      deletedAt: null,
      kind: { in: [...sensitivePacketDocumentKinds] },
      caseDocuments: { some: { caseId } },
      OR: [
        { retentionExpiresAt: null },
        { retentionExpiresAt: { gt: retentionExpiresAt } },
      ],
    },
    data: { retentionExpiresAt },
  });
  return retentionExpiresAt;
}

async function markSelfServiceCaseGenerated(
  transaction: PacketTransaction,
  caseId: string,
): Promise<void> {
  await transaction.administrativeCase.updateMany({
    where: {
      id: caseId,
      status: "READY_TO_PAY",
      fulfillmentMode: "SELF_SERVICE",
    },
    data: { status: "GENERATED" },
  });
}

export function sensitivePacketRetentionDeadline(
  generatedAt: Date,
  retentionDays = readPositiveInteger("SENSITIVE_DOCUMENT_RETENTION_DAYS", 30),
): Date {
  return new Date(generatedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
}

export function generatedPacketEncryptionContext(
  ownerId: string,
  caseId: string,
): Record<string, string> {
  return { ownerId, caseId, purpose: "GENERATED_PACKET" };
}

export const packetSafetyLimits = Object.freeze({
  attachmentCount: 20,
  singleAttachmentBytes: 20 * 1024 * 1024,
  aggregateAttachmentBytes: 50 * 1024 * 1024,
  totalPages: 200,
  outputBytes: 50 * 1024 * 1024,
  imagePixels: 40_000_000,
});

export function assertPacketAggregateLimits(
  attachments: ReadonlyArray<Pick<PacketAttachment, "bytes">>,
): void {
  assertPacketAttachmentSizes(
    attachments.map((attachment) => attachment.bytes.byteLength),
  );
}

export function assertPacketAttachmentSizes(
  attachmentSizes: ReadonlyArray<number>,
): void {
  if (attachmentSizes.length > packetSafetyLimits.attachmentCount) {
    throw new BadRequestException(
      `Un dossier ne peut pas contenir plus de ${packetSafetyLimits.attachmentCount} pieces.`,
    );
  }
  let aggregateBytes = 0;
  for (const size of attachmentSizes) {
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > packetSafetyLimits.singleAttachmentBytes
    ) {
      throw new BadRequestException(
        "Une piece jointe depasse la taille maximale autorisee.",
      );
    }
    aggregateBytes += size;
    if (aggregateBytes > packetSafetyLimits.aggregateAttachmentBytes) {
      throw new BadRequestException(
        "La taille cumulee des pieces jointes depasse la limite autorisee.",
      );
    }
  }
}

export async function assertPersistedPacket(
  bytes: Uint8Array,
  expectedChecksumSha256: string,
): Promise<void> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > packetSafetyLimits.outputBytes
  ) {
    throw new Error("Generated packet size is outside the safety limits.");
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== expectedChecksumSha256) {
    throw new Error("Generated packet checksum mismatch.");
  }
  const document = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > packetSafetyLimits.totalPages) {
    throw new Error(
      "Generated packet page count is outside the safety limits.",
    );
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function canGeneratePacket(status: string): boolean {
  return [
    "READY_TO_PAY",
    "PAID",
    "GENERATED",
    "PRINT_READY",
    "SENT",
    "REFUNDED",
  ].includes(status);
}

export function shouldGenerateFinalPacket(
  forceFinal: boolean,
  fulfillmentMode: string | null,
  paymentStatus: string | undefined,
): boolean {
  return (
    forceFinal || fulfillmentMode === "SELF_SERVICE" || paymentStatus === "PAID"
  );
}

export function findMissingRequiredDocumentLabels(
  requiredDocuments: unknown,
  attachedKinds: Iterable<string>,
): string[] {
  return findMissingDocumentRequirements(requiredDocuments, attachedKinds).map(
    (document) => documentRequirementShortName(document.kind),
  );
}

export async function createCasePacket(
  input: CreateCasePacketInput,
): Promise<Uint8Array> {
  assertPacketAggregateLimits(input.attachments ?? []);
  const document = await PDFDocument.create();
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const postalExpenseClaim = await addCalculatedPostalExpenseCosts(
    input.postalExpenseClaim,
    input.attachments ?? [],
    input.defaultPostageCents ?? DEFAULT_PRICING.greenLetterCents,
  );
  const { postalExpenseClaim: _postalExpenseClaim, ...letterInput } = input;
  appendReimbursementLetter(
    document,
    postalExpenseClaim ? { ...letterInput, postalExpenseClaim } : letterInput,
    regular,
    bold,
  );

  if (!input.preview) {
    await appendAttachments(document, input.attachments ?? []);
  }

  document.setTitle(
    `Demande de remboursement - ${shortenPdfText(input.gameName, 120)}`,
  );
  document.setAuthor(
    shortenPdfText(input.customerName || input.customerEmail, 120),
  );
  document.setSubject(
    "Demande personnelle de remboursement des frais de participation",
  );
  document.setCreationDate(new Date());
  if (document.getPageCount() > packetSafetyLimits.totalPages) {
    throw new BadRequestException(
      "Le dossier depasse le nombre maximal de pages autorise.",
    );
  }
  const bytes = await document.save();
  if (bytes.byteLength > packetSafetyLimits.outputBytes) {
    throw new BadRequestException(
      "Le PDF final depasse la taille maximale autorisee.",
    );
  }
  return bytes;
}

function appendReimbursementLetter(
  document: PDFDocument,
  input: CreateCasePacketInput & {
    postalExpenseClaim?: PacketPostalExpenseClaim;
  },
  regular: PDFFont,
  bold: PDFFont,
) {
  const page = document.addPage([595.28, 841.89]);
  const ink = rgb(0.08, 0.08, 0.08);
  const grey = rgb(0.35, 0.35, 0.35);
  const constraints = input.ruleConstraints ?? { requiredLetterMentions: [] };
  const recipient = shortenPdfText(
    constraints.reimbursementRecipient || input.organizer,
    120,
  );
  const senderLines = [
    { text: input.customerName || input.customerEmail, font: bold },
    ...postalAddressLines(input.customerAddress).map((text) => ({
      text,
      font: regular,
    })),
    { text: input.customerEmail, font: regular },
    ...(input.customerPhone
      ? [
          {
            text: `Téléphone : ${shortenPdfText(input.customerPhone, 30)}`,
            font: regular,
          },
        ]
      : []),
  ];
  const recipientLines = [
    { text: recipient, font: bold },
    ...postalAddressLines(constraints.reimbursementAddress).map((text) => ({
      text,
      font: regular,
    })),
    ...(constraints.reimbursementEmail
      ? [
          {
            text: shortenPdfText(constraints.reimbursementEmail, 100),
            font: regular,
          },
        ]
      : []),
  ];
  const senderY = drawLetterAddressBlock(page, senderLines, 52, 782, 225, ink);
  const recipientY = drawLetterAddressBlock(
    page,
    recipientLines,
    330,
    782,
    213,
    ink,
  );
  const dateY = Math.min(senderY, recipientY, 688) - 22;
  page.drawText(`Le ${formatLongDate(input.createdAt)}`, {
    x: 330,
    y: dateY,
    size: 10.5,
    font: regular,
    color: ink,
  });

  const flow: LetterFlow = {
    document,
    page,
    cursor: dateY - 48,
    regular,
    bold,
    ink,
    grey,
  };
  drawLetterParagraph(
    flow,
    "Objet : demande de remboursement de mes frais de participation",
    { font: bold, gapAfter: 20 },
  );
  drawLetterParagraph(flow, "Madame, Monsieur,", { gapAfter: 14 });
  const postalExpenseTotalCents =
    input.postalExpenseClaim?.calculatedCosts?.totalCents ?? null;
  const totalRequestedCents =
    postalExpenseTotalCents === null
      ? input.estimatedRecoverableCents
      : input.estimatedRecoverableCents + postalExpenseTotalCents;
  drawLetterParagraph(
    flow,
    postalExpenseTotalCents === null
      ? `Je vous adresse une demande de remboursement de ${formatEurosText(totalRequestedCents)} pour les frais engagés lors de ma participation au jeu « ${shortenPdfText(input.gameName, 180)} », conformément à son règlement.`
      : `Je vous adresse une demande de remboursement pour les frais engagés lors de ma participation au jeu « ${shortenPdfText(input.gameName, 180)} », conformément à son règlement.`,
  );

  const smsParagraph = smsParticipationParagraph(input.smsCharges ?? []);
  if (smsParagraph) drawLetterParagraph(flow, smsParagraph);

  const amountBreakdown = reimbursementAmountBreakdownParagraph(
    input.estimatedRecoverableCents,
    input.postalExpenseClaim?.calculatedCosts,
  );
  if (amountBreakdown) {
    drawLetterParagraph(flow, amountBreakdown);
    drawLetterParagraph(
      flow,
      `Montant total demandé : ${formatEurosText(totalRequestedCents)}.`,
      { font: bold },
    );
  }

  for (const paragraph of postalExpenseClaimParagraphs(
    input.postalExpenseClaim,
  )) {
    drawLetterParagraph(flow, paragraph);
  }

  if (input.customerPhone) {
    drawLetterParagraph(
      flow,
      `La ligne téléphonique utilisée pour participer est le ${shortenPdfText(input.customerPhone, 30)}.`,
    );
  }
  if (input.customerOperatorReference) {
    drawLetterParagraph(
      flow,
      `Ma référence client auprès de mon opérateur est ${shortenPdfText(input.customerOperatorReference, 60)}.`,
    );
  }
  if (constraints.reimbursementMethod) {
    drawLetterParagraph(
      flow,
      reimbursementMethodSentence(constraints.reimbursementMethod),
    );
  }

  const requiredDocuments = [
    ...new Map(
      (input.requiredDocuments ?? [])
        .filter((document) => document.required)
        .map((document) => [document.kind, personalAttachmentLabel(document)]),
    ).values(),
  ];
  if (requiredDocuments.length > 0) {
    drawLetterParagraph(
      flow,
      requiredDocuments.length === 1
        ? "Vous trouverez joint à ce courrier :"
        : "Vous trouverez joints à ce courrier :",
      { gapAfter: 4 },
    );
    requiredDocuments.forEach((label, index) => {
      drawLetterParagraph(
        flow,
        `- ${label}${index === requiredDocuments.length - 1 ? "." : " ;"}`,
        { x: 66, width: 477, gapAfter: 2 },
      );
    });
    flow.cursor -= 8;
  }

  const closing =
    "Je vous remercie par avance de l'attention portée à ma demande et vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.";
  ensureLetterSpace(flow, letterBlockHeight(closing, regular) + 82);
  drawLetterParagraph(flow, closing, { gapAfter: 24 });
  flow.page.drawText("Signature", {
    x: 390,
    y: flow.cursor,
    size: 10.5,
    font: regular,
    color: grey,
  });
  flow.page.drawText(
    normalizePdfText(input.customerName || input.customerEmail),
    {
      x: 390,
      y: flow.cursor - 42,
      size: 10.5,
      font: regular,
      color: ink,
    },
  );
}

async function appendAttachments(
  target: PDFDocument,
  attachments: PacketAttachment[],
) {
  for (const attachment of attachments) {
    if (attachment.mimeType === "application/pdf") {
      await appendPdfAttachment(target, attachment.bytes);
      continue;
    }

    if (
      attachment.mimeType === "image/png" ||
      attachment.mimeType === "image/jpeg"
    ) {
      await appendImageAttachment(target, attachment);
      continue;
    }

    throw new BadRequestException(
      `La piece "${attachment.name}" ne peut pas etre integree au PDF. Utilisez un fichier PDF, JPG ou PNG.`,
    );
  }
}

async function appendPdfAttachment(document: PDFDocument, bytes: Uint8Array) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
  if (
    document.getPageCount() + source.getPageCount() >
    packetSafetyLimits.totalPages
  ) {
    throw new BadRequestException(
      "Le dossier depasse le nombre maximal de pages autorise.",
    );
  }
  const pages = await document.copyPages(source, source.getPageIndices());
  for (const page of pages) {
    document.addPage(page);
  }
}

async function appendImageAttachment(
  document: PDFDocument,
  attachment: PacketAttachment,
) {
  const image =
    attachment.mimeType === "image/png"
      ? await document.embedPng(attachment.bytes)
      : await document.embedJpg(attachment.bytes);
  if (image.width * image.height > packetSafetyLimits.imagePixels) {
    throw new BadRequestException(
      `La piece "${attachment.name}" depasse la resolution maximale autorisee.`,
    );
  }
  if (document.getPageCount() + 1 > packetSafetyLimits.totalPages) {
    throw new BadRequestException(
      "Le dossier depasse le nombre maximal de pages autorise.",
    );
  }
  const page = document.addPage([595.28, 841.89]);
  drawCenteredImage(page, image);
}

function drawCenteredImage(page: PDFPage, image: PDFImage) {
  const pageWidth = page.getWidth();
  const pageHeight = page.getHeight();
  const margin = 36;
  const maxWidth = pageWidth - margin * 2;
  const maxHeight = pageHeight - margin * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  });
}

function postalAddressLines(value: string | undefined): string[] {
  if (!value) return [];
  return normalizePdfText(value)
    .split(/\r?\n|,\s*/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function drawLetterAddressBlock(
  page: PDFPage,
  entries: Array<{ text: string; font: PDFFont }>,
  x: number,
  y: number,
  width: number,
  color: ReturnType<typeof rgb>,
): number {
  let cursor = y;
  for (const entry of entries) {
    for (const line of wrapPdfText(entry.text, entry.font, 10.5, width)) {
      page.drawText(line, {
        x,
        y: cursor,
        size: 10.5,
        font: entry.font,
        color,
      });
      cursor -= 14;
    }
  }
  return cursor;
}

function wrapPdfText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = normalizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

function drawLetterParagraph(
  flow: LetterFlow,
  text: string,
  options: {
    font?: PDFFont;
    x?: number;
    width?: number;
    size?: number;
    lineHeight?: number;
    gapAfter?: number;
  } = {},
) {
  const font = options.font ?? flow.regular;
  const x = options.x ?? 52;
  const width = options.width ?? 491;
  const size = options.size ?? 10.5;
  const lineHeight = options.lineHeight ?? 15;
  const gapAfter = options.gapAfter ?? 10;
  const lines = wrapPdfText(text, font, size, width);
  ensureLetterSpace(flow, lines.length * lineHeight);
  for (const line of lines) {
    if (flow.cursor - lineHeight < 64) addLetterPage(flow);
    flow.page.drawText(line, {
      x,
      y: flow.cursor,
      size,
      font,
      color: flow.ink,
    });
    flow.cursor -= lineHeight;
  }
  flow.cursor -= gapAfter;
}

function letterBlockHeight(
  text: string,
  font: PDFFont,
  size = 10.5,
  width = 491,
): number {
  return wrapPdfText(text, font, size, width).length * 15;
}

function ensureLetterSpace(flow: LetterFlow, height: number) {
  if (flow.cursor - height < 64) addLetterPage(flow);
}

function addLetterPage(flow: LetterFlow) {
  flow.page = flow.document.addPage([595.28, 841.89]);
  flow.cursor = 790;
}

function normalizePdfText(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, " ");
}

function shortenPdfText(text: string, maxLength: number): string {
  const normalized = normalizePdfText(text).replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatEurosText(cents: number): string {
  const amount = (cents / 100).toFixed(2).replace(".", ",");
  return `${amount} ${Math.abs(cents) > 100 ? "euros" : "euro"}`;
}

export function smsParticipationParagraph(
  smsCharges: ReadonlyArray<PacketSmsCharge>,
): string | null {
  const totalQuantity = smsCharges.reduce(
    (total, charge) => total + charge.quantity,
    0,
  );
  if (totalQuantity <= 0) return null;
  const codes = [
    ...new Set(
      smsCharges.flatMap((charge) => (charge.code ? [charge.code] : [])),
    ),
  ];
  const quantity = totalQuantity === 1 ? "un SMS" : `${totalQuantity} SMS`;
  const sent = totalQuantity === 1 ? "envoyé" : "envoyés";
  const destination =
    codes.length === 1
      ? ` au numéro court ${codes[0]}`
      : codes.length > 1
        ? ` aux numéros courts ${joinFrench(codes)}`
        : "";
  return `La facture détaillée de mon opérateur, jointe à ce courrier, fait apparaître ${quantity} ${sent}${destination} pour participer à ce jeu.`;
}

export function postalExpenseClaimParagraphs(
  claim: PacketPostalExpenseClaim | undefined,
): string[] {
  if (!claim?.requested) return [];
  const postage = claim.terms.postage.reimbursable;
  const printing = claim.terms.printing.reimbursable;
  if (!postage && !printing) return [];

  const requestedCosts =
    postage && printing
      ? "mes frais d'affranchissement et d'impression des pièces jointes"
      : postage
        ? "mes frais d'affranchissement"
        : "mes frais d'impression des pièces jointes";
  const paragraphs = [
    `Je demande également le remboursement de ${requestedCosts}, comme le prévoit ${postalExpenseSource(claim.terms.sourceReference)}.`,
  ];
  const rates = [
    claim.terms.postage.reimbursable
      ? claim.terms.postage.amountCents !== null
        ? `le remboursement de l'affranchissement à hauteur de ${formatEurosText(claim.terms.postage.amountCents)}`
        : claim.terms.postage.basis
          ? `le remboursement de l'affranchissement sur la base du tarif suivant : ${stripFinalPunctuation(claim.terms.postage.basis)}`
          : ""
      : "",
    claim.terms.printing.reimbursable
      ? claim.terms.printing.centsPerPage !== null
        ? `le remboursement des frais d'impression à hauteur de ${formatEurosText(claim.terms.printing.centsPerPage)} par page${claim.terms.printing.maxPages ? `, dans la limite de ${claim.terms.printing.maxPages} pages` : ""}`
        : claim.terms.printing.basis
          ? `le remboursement des frais d'impression selon le barème suivant : ${stripFinalPunctuation(claim.terms.printing.basis)}`
          : ""
      : "",
  ].filter(Boolean);
  if (rates.length > 0) {
    paragraphs.push(`Le règlement prévoit ${joinFrench(rates)}.`);
  }
  const calculated = postalExpenseClaimCostSentence(claim.calculatedCosts);
  if (calculated) paragraphs.push(calculated);
  const limit = strictPostalExpenseLimitSentence(claim.terms.claimLimit);
  if (limit) paragraphs.push(limit);
  return paragraphs;
}

async function addCalculatedPostalExpenseCosts(
  claim: CaseValidationSnapshot["postalExpenseClaim"] | undefined,
  attachments: PacketAttachment[],
  defaultPostageCents: number,
): Promise<PacketPostalExpenseClaim | undefined> {
  if (!claim?.requested) return claim;
  const requestPageCount = 1 + (await countAttachmentPages(attachments));
  const calculatedCosts = calculatePostalExpenseClaimCosts(
    claim,
    requestPageCount,
    defaultPostageCents,
  );
  return calculatedCosts ? { ...claim, calculatedCosts } : claim;
}

export function calculatePostalExpenseClaimCosts(
  claim: CaseValidationSnapshot["postalExpenseClaim"] | undefined,
  requestPageCount: number,
  defaultPostageCents: number = DEFAULT_PRICING.greenLetterCents,
): PacketPostalExpenseCosts | null {
  if (!claim?.requested || !claim.terms.available) return null;

  const postageCents = claim.terms.postage.reimbursable
    ? (claim.terms.postage.amountCents ?? defaultPostageCents)
    : 0;
  const printingPageCount =
    claim.terms.printing.reimbursable &&
    claim.terms.printing.centsPerPage !== null
      ? Math.min(
          Math.max(0, Math.trunc(requestPageCount)),
          claim.terms.printing.maxPages ?? Number.MAX_SAFE_INTEGER,
        )
      : 0;
  const printingCents =
    claim.terms.printing.reimbursable &&
    claim.terms.printing.centsPerPage !== null
      ? printingPageCount * claim.terms.printing.centsPerPage
      : claim.terms.printing.reimbursable
        ? null
        : 0;
  const totalCents =
    postageCents === null || printingCents === null
      ? null
      : postageCents + printingCents;

  return {
    postageCents,
    printingCents,
    printingCentsPerPage: claim.terms.printing.centsPerPage,
    printingPageCount,
    totalCents,
  };
}

async function countAttachmentPages(attachments: PacketAttachment[]) {
  let total = 0;
  for (const attachment of attachments) {
    if (attachment.mimeType === "application/pdf") {
      const source = await PDFDocument.load(attachment.bytes, {
        ignoreEncryption: true,
      });
      total += source.getPageCount();
      continue;
    }
    if (
      attachment.mimeType === "image/png" ||
      attachment.mimeType === "image/jpeg"
    ) {
      total += 1;
    }
  }
  return total;
}

function postalExpenseClaimCostSentence(
  costs: PacketPostalExpenseCosts | undefined,
): string {
  if (!costs || costs.totalCents === null) return "";
  const details = [
    costs.postageCents && costs.postageCents > 0
      ? `affranchissement : ${formatEurosText(costs.postageCents)}`
      : "",
    costs.printingCents && costs.printingCents > 0
      ? `impression : ${formatEurosText(costs.printingCents)} pour ${costs.printingPageCount} ${costs.printingPageCount > 1 ? "pages" : "page"}`
      : "",
  ].filter(Boolean);
  return details.length > 0
    ? `Ces frais d'envoi s'élèvent à ${formatEurosText(costs.totalCents)} (${details.join(" ; ")}).`
    : "";
}

function reimbursementAmountBreakdownParagraph(
  smsCents: number,
  costs: PacketPostalExpenseCosts | undefined,
): string {
  if (!costs || costs.totalCents === null) return "";
  const parts = [
    `${formatEurosText(smsCents)} de SMS`,
    costs.printingCents &&
    costs.printingCents > 0 &&
    costs.printingCentsPerPage !== null
      ? `${formatEurosText(costs.printingCents)} de frais d'impression (${costs.printingPageCount} ${costs.printingPageCount > 1 ? "pages" : "page"} à ${formatEurosText(costs.printingCentsPerPage)} par page)`
      : "",
    costs.postageCents && costs.postageCents > 0
      ? `${formatEurosText(costs.postageCents)} pour le timbre`
      : "",
  ].filter(Boolean);
  return `Cette demande comprend ${joinFrench(parts)}.`;
}

function postalExpenseSource(sourceReference: string): string {
  const source = shortenPdfText(sourceReference, 100);
  const article = /^article\s+(.+)$/i.exec(source);
  if (article) return `l'article ${article[1]} du règlement`;
  const section = /^section\s+(.+)$/i.exec(source);
  if (section) return `la section ${section[1]} du règlement`;
  return "le règlement du jeu";
}

function strictPostalExpenseLimitSentence(
  limit: PostalExpenseReimbursement["claimLimit"],
): string {
  if (!limit.strict) return "";
  if (limit.scope === "PER_PARTICIPANT_PER_MONTH") {
    return "Il s'agit de ma seule demande de remboursement de ces frais pour ce mois.";
  }
  if (limit.scope === "PER_PARTICIPANT_PER_GAME") {
    return "Il s'agit de ma seule demande de remboursement de ces frais pour ce jeu.";
  }
  if (limit.scope === "PER_HOUSEHOLD_PER_GAME") {
    return "Cette demande est la seule présentée par mon foyer pour ce jeu.";
  }
  if (limit.scope === "OTHER" && limit.details) {
    return `Cette demande respecte la limite prévue par le règlement : ${stripFinalPunctuation(shortenPdfText(limit.details, 180))}.`;
  }
  return "";
}

function stripFinalPunctuation(value: string): string {
  return shortenPdfText(value, 220).replace(/[.;:,\s]+$/, "");
}

function reimbursementMethodSentence(method: string): string {
  if (/virement/i.test(method)) {
    return "Je souhaite recevoir ce remboursement par virement bancaire sur le compte indiqué dans le RIB joint.";
  }
  return `Je souhaite recevoir ce remboursement par ${lowerFirst(stripFinalPunctuation(method))}.`;
}

function personalAttachmentLabel(document: RequiredPacketDocument): string {
  if (document.kind === "ORANGE_INVOICE") {
    return "la facture détaillée de mon opérateur";
  }
  if (document.kind === "IDENTITY_DOCUMENT") {
    return "une copie de ma pièce d'identité";
  }
  if (document.kind === "BANK_DETAILS") {
    return "mon relevé d'identité bancaire (RIB)";
  }
  if (document.kind === "PURCHASE_PROOF") {
    return /opérateur|mobile|sms/i.test(document.label)
      ? "la facture détaillée de mon opérateur"
      : "la preuve d'achat demandée";
  }
  if (document.kind === "TRAIN_TICKET") return "mon billet de train";
  if (document.kind === "FLIGHT_TICKET") return "mon billet d'avion";
  if (document.kind === "WARRANTY") return "mon justificatif de garantie";
  return lowerFirst(
    shortenPdfText(
      document.label || documentRequirementShortName(document.kind),
      120,
    ),
  );
}

function lowerFirst(value: string): string {
  return value
    ? `${value.charAt(0).toLocaleLowerCase("fr-FR")}${value.slice(1)}`
    : "";
}

function joinFrench(values: string[]): string {
  if (values.length < 2) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} et ${values.at(-1)}`;
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Paris",
  }).format(date);
}

function readRuleConstraints(value: unknown): PacketRuleConstraints {
  const constraints =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const readString = (key: string) =>
    typeof constraints[key] === "string" && constraints[key].trim()
      ? (constraints[key] as string)
      : undefined;
  const reimbursementRecipient = readString("reimbursementRecipient");
  const reimbursementAddress = readString("reimbursementAddress");
  const reimbursementEmail = readString("reimbursementEmail");
  const reimbursementDeadline = readString("reimbursementDeadline");
  const reimbursementMethod = readString("reimbursementMethod");

  return {
    ...(reimbursementRecipient ? { reimbursementRecipient } : {}),
    ...(reimbursementAddress ? { reimbursementAddress } : {}),
    ...(reimbursementEmail ? { reimbursementEmail } : {}),
    ...(reimbursementDeadline ? { reimbursementDeadline } : {}),
    ...(reimbursementMethod ? { reimbursementMethod } : {}),
    requiredLetterMentions: Array.isArray(constraints.requiredLetterMentions)
      ? constraints.requiredLetterMentions.filter(
          (mention): mention is string =>
            typeof mention === "string" && Boolean(mention.trim()),
        )
      : [],
  };
}

function readSmsCharges(value: unknown): PacketSmsCharge[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const charges = (value as Record<string, unknown>).detectedSmsCharges;
  if (!Array.isArray(charges)) {
    return [];
  }

  return charges.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const charge = item as Record<string, unknown>;
    if (
      typeof charge.label !== "string" ||
      typeof charge.quantity !== "number" ||
      typeof charge.amountCents !== "number"
    ) {
      return [];
    }
    return [
      {
        label: charge.label,
        ...(typeof charge.code === "string" ? { code: charge.code } : {}),
        quantity: charge.quantity,
        amountCents: charge.amountCents,
      },
    ];
  });
}
