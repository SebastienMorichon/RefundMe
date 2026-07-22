import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AnalyzeOrangeInvoiceEligibility } from "@lydoc/application";
import { DocumentKind, DocumentStatus, Prisma, RuleStatus } from "@prisma/client";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { MistralOcrProvider } from "@lydoc/infrastructure";
import { missingCustomerProfileFields } from "../identity/customer-profile";
import { PrismaService } from "../prisma/prisma.service";
import {
  addRuleSnapshotToCompliance,
  createCaseRuleSnapshot,
  createCustomerSnapshot,
  readCaseValidationSnapshot,
  readRuleSnapshotFromCompliance,
  type CaseRuleSnapshot,
  type CaseValidationSnapshot,
} from "./case-snapshots";

@Injectable()
export class EligibilityService {
  private readonly analyzer = new AnalyzeOrangeInvoiceEligibility();
  private readonly mistralOcr = new MistralOcrProvider(process.env.MISTRAL_API_KEY ?? "");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
  ) {}

  async analyzeInvoice(documentId: string, ownerId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
      include: { ocrResult: true },
    });

    if (!document) {
      throw new NotFoundException("Document introuvable.");
    }

    if (document.kind !== DocumentKind.ORANGE_INVOICE) {
      throw new BadRequestException("Seules les factures Orange peuvent etre analysees ici.");
    }

    const ocr = document.ocrResult
      ? {
          text: document.ocrResult.text,
          provider: document.ocrResult.provider,
          ...(document.ocrResult.confidence ? { confidence: Number(document.ocrResult.confidence) } : {}),
          raw: document.ocrResult.rawJson,
        }
      : await this.runOcr(document, ownerId);
    const rules = await this.prisma.gameRule.findMany({
      where: { status: RuleStatus.APPROVED },
      include: { organizer: true },
    });
    const analysis = this.analyzer.execute({
      text: ocr.text,
      approvedRules: rules.map((rule) => ({
        id: rule.id,
        organizerName: rule.organizer.name,
        name: rule.name,
        reimbursementCents: rule.reimbursementCents,
        requiredDocuments: rule.requiredDocuments,
        constraints: rule.constraintsJson,
        ...(rule.validFrom ? { validFrom: rule.validFrom } : {}),
        ...(rule.validUntil ? { validUntil: rule.validUntil } : {}),
      })),
    });
    const candidate = analysis.candidates[0];

    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.ocrResult.upsert({
        where: { documentId: document.id },
        create: {
          documentId: document.id,
          provider: ocr.provider,
          text: ocr.text,
          ...(ocr.confidence === undefined ? {} : { confidence: ocr.confidence }),
          rawJson: {
            isOrangeInvoice: analysis.isOrangeInvoice,
            participationCount: analysis.participationCount,
            detectedSmsCharges: analysis.detectedSmsCharges,
            provider: ocr.provider,
            ocr: toJsonValue(ocr.raw),
          },
        },
        update: {
          provider: ocr.provider,
          text: ocr.text,
          ...(ocr.confidence === undefined ? {} : { confidence: ocr.confidence }),
          rawJson: {
            isOrangeInvoice: analysis.isOrangeInvoice,
            participationCount: analysis.participationCount,
            detectedSmsCharges: analysis.detectedSmsCharges,
            provider: ocr.provider,
            ocr: toJsonValue(ocr.raw),
          },
        },
      });
      await transaction.document.update({
        where: { id: document.id },
        data: { status: DocumentStatus.ANALYZED, analyzedAt: new Date() },
      });

      const existingCaseDocument = await transaction.caseDocument.findFirst({
        where: { documentId: document.id, purpose: "SOURCE_INVOICE" },
        include: { case: true },
      });
      if (existingCaseDocument) {
        return existingCaseDocument.case;
      }

      if (!candidate && analysis.detectedSmsCharges.length === 0) {
        return null;
      }

      if (!candidate) {
        const totalRecoverableCents = analysis.detectedSmsCharges.reduce((total, charge) => total + charge.amountCents, 0);
        const genericRule = await transaction.gameRule.create({
          data: {
            organizer: {
              connectOrCreate: {
                where: { slug: "sms-plus-orange" },
                create: { name: "SMS+ Orange", slug: "sms-plus-orange" },
              },
            },
            sourceDocument: { connect: { id: document.id } },
            status: RuleStatus.NEEDS_REVIEW,
            name: "Frais SMS+ detectes",
            reimbursementCents: totalRecoverableCents,
            requiredDocuments: [
              { kind: "ORANGE_INVOICE", label: "Facture operateur", required: true },
              { kind: "BANK_DETAILS", label: "RIB", required: true },
            ] as Prisma.InputJsonValue,
            constraintsJson: {
              detection: "SMS+ avec code court present sur facture operateur",
              smsCharges: analysis.detectedSmsCharges,
            } as Prisma.InputJsonValue,
          },
          include: { organizer: true },
        });
        const ruleSnapshot = createCaseRuleSnapshot(genericRule);

        return transaction.administrativeCase.create({
          data: {
            ownerId,
            gameRuleId: genericRule.id,
            estimatedRecoverableCents: totalRecoverableCents,
            confidence: 0.72,
            complianceSnapshotJson: {
              evidence: [
                "SMS+ detectes sur la facture operateur",
                ...analysis.detectedSmsCharges.map((charge) => `Ligne SMS+: ${charge.label}`),
              ],
              detectedSmsCharges: analysis.detectedSmsCharges,
              missingRequirements: ["RIB"],
              ruleSnapshot,
            } as Prisma.InputJsonValue,
            documents: { create: { documentId: document.id, purpose: "SOURCE_INVOICE" } },
          },
        });
      }

      const matchedRule = rules.find((rule) => rule.id === candidate.ruleId);
      if (!matchedRule) {
        throw new BadRequestException("Le reglement identifie n'est plus disponible.");
      }
      const ruleSnapshot = createCaseRuleSnapshot(matchedRule);

      return transaction.administrativeCase.create({
        data: {
          ownerId,
          gameRuleId: candidate.ruleId,
          estimatedRecoverableCents: candidate.reimbursementCents,
          confidence: candidate.confidence,
          complianceSnapshotJson: {
            evidence: candidate.evidence,
            detectedSmsCharges: candidate.detectedSmsCharges,
            missingRequirements: candidate.missingRequirements.filter((label) => !label.toLocaleLowerCase("fr-FR").includes("facture")),
            ruleSnapshot,
          } as Prisma.InputJsonValue,
          documents: { create: { documentId: document.id, purpose: "SOURCE_INVOICE" } },
        },
      });
    });

    return {
      document: {
        id: document.id,
        isOrangeInvoice: analysis.isOrangeInvoice,
        participationCount: analysis.participationCount,
        detectedSmsCharges: analysis.detectedSmsCharges,
      },
      candidates: analysis.candidates,
      case: result ? this.presentCase(result) : null,
    };
  }

  async listCases(ownerId: string) {
    const cases = await this.prisma.administrativeCase.findMany({
      where: { ownerId },
      include: { gameRule: { include: { organizer: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return cases.map((administrativeCase) => ({
      ...this.presentCase(administrativeCase),
      rule: administrativeCase.gameRule
        ? (() => {
            const snapshot = readRuleSnapshotFromCompliance(administrativeCase.complianceSnapshotJson)
              ?? createCaseRuleSnapshot(administrativeCase.gameRule);
            return { id: snapshot.ruleId, name: snapshot.name, organizer: snapshot.organizerName };
          })()
        : null,
    }));
  }

  async getCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    return this.presentCaseDetail(administrativeCase);
  }

  async confirmCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    if (!["READY_TO_PAY", "PAID"].includes(administrativeCase.status)) {
      throw new BadRequestException("Reunissez toutes les pieces avant de valider le dossier.");
    }
    const missingDocuments = this.missingDocuments(administrativeCase);
    if (missingDocuments.length > 0) {
      throw new BadRequestException(`Ajoutez les pieces manquantes : ${missingDocuments.map((item) => item.label).join(", ")}.`);
    }
    const missingProfileFields = missingCustomerProfileFields(administrativeCase.owner);
    if (missingProfileFields.length > 0) {
      throw new BadRequestException(`Completez votre profil avant la validation : ${missingProfileFields.join(", ")}.`);
    }

    const confirmedAt = new Date();
    const ruleSnapshot = this.ruleSnapshot(administrativeCase);
    const validationSnapshot: CaseValidationSnapshot = {
      version: 1,
      confirmedAt: confirmedAt.toISOString(),
      rule: ruleSnapshot,
      customer: createCustomerSnapshot(administrativeCase.owner),
      documents: administrativeCase.documents.map(({ document }) => ({
        id: document.id,
        kind: document.kind,
        originalName: document.originalName,
      })),
      estimatedRecoverableCents: administrativeCase.estimatedRecoverableCents,
      serviceFeeCents: administrativeCase.serviceFeeCents,
    };

    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.administrativeCase.update({
        where: { id: administrativeCase.id },
        data: {
          validatedAt: confirmedAt,
          validationSnapshotJson: validationSnapshot as Prisma.InputJsonValue,
          complianceSnapshotJson: addRuleSnapshotToCompliance(
            administrativeCase.complianceSnapshotJson,
            ruleSnapshot,
          ) as Prisma.InputJsonValue,
        },
        include: this.caseDetailIncludes,
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_VALIDATED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: { ruleId: ruleSnapshot.ruleId, ruleVersion: ruleSnapshot.version },
        },
      });
      return updated;
    });

    return this.presentCaseDetail(updatedCase);
  }

  async deleteCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId },
      select: { id: true },
    });
    if (!administrativeCase) {
      throw new NotFoundException("Dossier introuvable.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.generatedPacket.deleteMany({ where: { caseId: administrativeCase.id } });
      await transaction.postalShipment.deleteMany({ where: { caseId: administrativeCase.id } });
      await transaction.payment.deleteMany({ where: { caseId: administrativeCase.id } });
      await transaction.caseDocument.deleteMany({ where: { caseId: administrativeCase.id } });
      await transaction.administrativeCase.delete({ where: { id: administrativeCase.id } });
    });

    return true;
  }

  async markRefunded(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    if (administrativeCase.status === "REFUNDED") {
      return this.presentCaseDetail(administrativeCase);
    }
    if (!administrativeCase.validatedAt || !administrativeCase.fulfillmentMode) {
      throw new BadRequestException("Finalisez le dossier avant de confirmer son remboursement.");
    }
    if (["REJECTED", "CANCELLED"].includes(administrativeCase.status)) {
      throw new BadRequestException("Ce dossier cloture ne peut pas etre marque comme rembourse.");
    }

    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.administrativeCase.update({
        where: { id: administrativeCase.id },
        data: { status: "REFUNDED" },
        include: this.caseDetailIncludes,
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_REFUND_CONFIRMED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: { estimatedRecoverableCents: administrativeCase.estimatedRecoverableCents },
        },
      });
      return updated;
    });

    return this.presentCaseDetail(updatedCase);
  }

  async chooseFulfillment(caseId: string, mode: string, ownerId: string) {
    if (!['SELF_SERVICE', 'MANAGED_POSTAL'].includes(mode)) {
      throw new BadRequestException("Choisissez le téléchargement gratuit ou l'envoi pris en charge.");
    }

    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    if (!administrativeCase.validatedAt || !readCaseValidationSnapshot(administrativeCase.validationSnapshotJson)) {
      throw new BadRequestException("Validez le récapitulatif avant de choisir votre mode d'envoi.");
    }
    if (administrativeCase.payment?.status === "PAID") {
      throw new BadRequestException("Le mode d'envoi ne peut plus être modifié après le paiement.");
    }
    if (administrativeCase.postalShipment && !["DRAFT", "QUOTED", "FAILED", "CANCELLED"].includes(administrativeCase.postalShipment.status)) {
      throw new BadRequestException("Le mode d'envoi ne peut plus être modifié après sa prise en charge.");
    }

    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      if (mode === "SELF_SERVICE") {
        await transaction.payment.deleteMany({ where: { caseId } });
        await transaction.postalShipment.deleteMany({ where: { caseId } });
      }
      const updated = await transaction.administrativeCase.update({
        where: { id: caseId },
        data: {
          fulfillmentMode: mode as "SELF_SERVICE" | "MANAGED_POSTAL",
          ...(mode === "MANAGED_POSTAL" && administrativeCase.status === "GENERATED" ? { status: "READY_TO_PAY" as const } : {}),
        },
        include: this.caseDetailIncludes,
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_FULFILLMENT_SELECTED",
          entityType: "AdministrativeCase",
          entityId: caseId,
          metadata: { mode },
        },
      });
      return updated;
    });

    return this.presentCaseDetail(updatedCase);
  }

  async startCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    if (administrativeCase.status !== "DRAFT") {
      return this.presentCaseDetail(administrativeCase);
    }

    const nextStatus = this.missingDocuments(administrativeCase).length > 0
      ? "WAITING_FOR_USER_DOCUMENTS"
      : "READY_TO_PAY";
    const updatedCase = await this.prisma.administrativeCase.update({
      where: { id: administrativeCase.id },
      data: { status: nextStatus },
      include: this.caseDetailIncludes,
    });
    return this.presentCaseDetail(updatedCase);
  }

  async attachDocument(caseId: string, documentId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    if (administrativeCase.status === "PAID" || administrativeCase.status === "SENT") {
      throw new BadRequestException("Ce dossier ne peut plus etre modifie.");
    }

    const document = await this.prisma.document.findFirst({ where: { id: documentId, ownerId } });
    if (!document) {
      throw new NotFoundException("Piece introuvable.");
    }

    const requiredDocuments = readRequiredDocuments(this.ruleSnapshot(administrativeCase).requiredDocuments);
    const requiredDocument = requiredDocuments.find((item) => item.kind === document.kind && item.required);
    if (!requiredDocument) {
      throw new BadRequestException("Cette piece n'est pas demandee par ce dossier.");
    }

    await this.prisma.caseDocument.upsert({
      where: {
        caseId_documentId_purpose: {
          caseId: administrativeCase.id,
          documentId: document.id,
          purpose: `REQUIRED:${document.kind}`,
        },
      },
      create: { caseId: administrativeCase.id, documentId: document.id, purpose: `REQUIRED:${document.kind}` },
      update: {},
    });

    const refreshedCase = await this.findOwnedCase(caseId, ownerId);
    const missingDocuments = this.missingDocuments(refreshedCase);
    const updatedCase = await this.prisma.administrativeCase.update({
      where: { id: refreshedCase.id },
      data: { status: missingDocuments.length === 0 ? "READY_TO_PAY" : "WAITING_FOR_USER_DOCUMENTS" },
      include: this.caseDetailIncludes,
    });

    return this.presentCaseDetail(updatedCase);
  }

  private readonly caseDetailIncludes = {
    gameRule: { include: { organizer: true } },
    owner: {
      select: {
        firstName: true,
        email: true,
        lastName: true,
        postalAddress: true,
        postalCode: true,
        city: true,
        country: true,
        phoneNumber: true,
        operatorCustomerReference: true,
      },
    },
    documents: { include: { document: { select: { id: true, kind: true, originalName: true, uploadedAt: true } } } },
    payment: { select: { status: true, paidAt: true } },
    postalShipment: {
      select: {
        provider: true,
        environment: true,
        product: true,
        status: true,
        postageCents: true,
        providerServiceCents: true,
        totalCents: true,
        currency: true,
        previewUrl: true,
        trackingNumber: true,
        proofOfDepositUrl: true,
        errorMessage: true,
        quotedAt: true,
        submittedAt: true,
        deliveredAt: true,
      },
    },
  } as const;

  private async findOwnedCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.prisma.administrativeCase.findFirst({
      where: { id: caseId, ownerId },
      include: this.caseDetailIncludes,
    });
    if (!administrativeCase) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (!administrativeCase.gameRule) {
      throw new BadRequestException("Ce dossier n'est associe a aucun reglement.");
    }
    return administrativeCase;
  }

  private presentCaseDetail(administrativeCase: Awaited<ReturnType<EligibilityService["findOwnedCase"]>>) {
    const gameRule = administrativeCase.gameRule;
    if (!gameRule) {
      throw new BadRequestException("Ce dossier n'est associe a aucun reglement.");
    }

    const ruleSnapshot = this.ruleSnapshot(administrativeCase);
    const requiredDocuments = readRequiredDocuments(ruleSnapshot.requiredDocuments);
    const attachedKinds = new Set<string>(administrativeCase.documents.map((caseDocument) => caseDocument.document.kind));
    const required = requiredDocuments.map((document) => ({
      ...document,
      supplied: attachedKinds.has(document.kind),
    }));
    const missingProfileFields = missingCustomerProfileFields(administrativeCase.owner);

    return {
      ...this.presentCase(administrativeCase),
      rule: {
        id: ruleSnapshot.ruleId,
        version: ruleSnapshot.version,
        name: ruleSnapshot.name,
        organizer: ruleSnapshot.organizerName,
      },
      requiredDocuments: required,
      missingDocuments: required.filter((document) => document.required && !document.supplied),
      customerProfile: {
        complete: missingProfileFields.length === 0,
        missingFields: missingProfileFields,
      },
      attachedDocuments: administrativeCase.documents.map((caseDocument) => ({
        id: caseDocument.document.id,
        kind: caseDocument.document.kind,
        originalName: caseDocument.document.originalName,
        uploadedAt: caseDocument.document.uploadedAt,
      })),
      payment: administrativeCase.payment
        ? { status: administrativeCase.payment.status, paidAt: administrativeCase.payment.paidAt }
        : null,
      postalShipment: administrativeCase.postalShipment
        ? {
            ...administrativeCase.postalShipment,
            simulation: administrativeCase.postalShipment.provider === "mock" || administrativeCase.postalShipment.environment !== "production",
          }
        : null,
      validation: administrativeCase.validatedAt
        ? { validatedAt: administrativeCase.validatedAt }
        : null,
      review: {
        reimbursementRecipient: readText(ruleSnapshot.constraints.reimbursementRecipient) || ruleSnapshot.organizerName,
        reimbursementAddress: readText(ruleSnapshot.constraints.reimbursementAddress),
        reimbursementDeadline: readText(ruleSnapshot.constraints.reimbursementDeadline),
        detectedSmsCount: readDetectedSmsCount(administrativeCase.complianceSnapshotJson),
      },
    };
  }

  private missingDocuments(administrativeCase: Awaited<ReturnType<EligibilityService["findOwnedCase"]>>) {
    return this.presentCaseDetail(administrativeCase).missingDocuments;
  }

  private ruleSnapshot(administrativeCase: Awaited<ReturnType<EligibilityService["findOwnedCase"]>>): CaseRuleSnapshot {
    const existing = readRuleSnapshotFromCompliance(administrativeCase.complianceSnapshotJson);
    if (existing) return existing;
    if (!administrativeCase.gameRule) {
      throw new BadRequestException("Ce dossier n'est associe a aucun reglement.");
    }
    return createCaseRuleSnapshot(administrativeCase.gameRule);
  }

  private presentCase(administrativeCase: {
    id: string;
    status: string;
    fulfillmentMode: string | null;
    estimatedRecoverableCents: number;
    serviceFeeCents: number;
    confidence: Prisma.Decimal | null;
    complianceSnapshotJson: Prisma.JsonValue;
    createdAt: Date;
  }) {
    return {
      id: administrativeCase.id,
      status: administrativeCase.status,
      fulfillmentMode: administrativeCase.fulfillmentMode,
      estimatedRecoverableCents: administrativeCase.estimatedRecoverableCents,
      serviceFeeCents: administrativeCase.serviceFeeCents,
      confidence: administrativeCase.confidence ? Number(administrativeCase.confidence) : null,
      compliance: administrativeCase.complianceSnapshotJson,
      createdAt: administrativeCase.createdAt,
    };
  }

  private async runOcr(
    document: {
      storageBucket: string;
      storageKey: string;
      checksumSha256: string;
      sizeBytes: number;
      kind: DocumentKind;
      mimeType: string;
    },
    ownerId: string,
  ) {
    const bytes = await this.storage.getDecryptedObject({
      object: {
        bucket: document.storageBucket,
        key: document.storageKey,
        checksumSha256: document.checksumSha256,
        sizeBytes: document.sizeBytes,
      },
      encryptionContext: { ownerId, documentKind: document.kind },
    });

    return this.mistralOcr.extractText({ bytes, mimeType: document.mimeType });
  }
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readDetectedSmsCount(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const charges = (value as Record<string, unknown>).detectedSmsCharges;
  if (!Array.isArray(charges)) return 0;
  return charges.reduce((total, charge) => {
    if (!charge || typeof charge !== "object") return total;
    const quantity = (charge as Record<string, unknown>).quantity;
    return total + (typeof quantity === "number" && Number.isFinite(quantity) ? quantity : 0);
  }, 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? {} : JSON.parse(serialized) as Prisma.InputJsonValue;
}

function readRequiredDocuments(value: unknown): Array<{ kind: string; label: string; required: boolean }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((document) => {
    if (!document || typeof document !== "object") return [];
    const candidate = document as Record<string, unknown>;
    return typeof candidate.kind === "string" && typeof candidate.label === "string" && typeof candidate.required === "boolean"
      ? [{ kind: candidate.kind, label: candidate.label, required: candidate.required }]
      : [];
  });
}
