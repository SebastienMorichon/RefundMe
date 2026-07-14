import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AnalyzeOrangeInvoiceEligibility } from "@lydoc/application";
import { DocumentKind, DocumentStatus, Prisma, RuleStatus } from "@prisma/client";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { MistralOcrProvider } from "@lydoc/infrastructure";
import { PrismaService } from "../prisma/prisma.service";

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
            provider: ocr.provider,
            ocr: toJsonValue(ocr.raw),
          },
        },
      });
      await transaction.document.update({
        where: { id: document.id },
        data: { status: DocumentStatus.ANALYZED, analyzedAt: new Date() },
      });

      if (!candidate) {
        return null;
      }

      const existingCaseDocument = await transaction.caseDocument.findFirst({
        where: { documentId: document.id, purpose: "SOURCE_INVOICE" },
        include: { case: true },
      });
      if (existingCaseDocument) {
        return existingCaseDocument.case;
      }

      return transaction.administrativeCase.create({
        data: {
          ownerId,
          gameRuleId: candidate.ruleId,
          estimatedRecoverableCents: candidate.reimbursementCents,
          confidence: candidate.confidence,
          complianceSnapshotJson: {
            evidence: candidate.evidence,
            missingRequirements: candidate.missingRequirements.filter((label) => !label.toLocaleLowerCase("fr-FR").includes("facture")),
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
        ? { id: administrativeCase.gameRule.id, name: administrativeCase.gameRule.name, organizer: administrativeCase.gameRule.organizer.name }
        : null,
    }));
  }

  async getCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    return this.presentCaseDetail(administrativeCase);
  }

  async startCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    if (administrativeCase.status !== "DRAFT") {
      return this.presentCaseDetail(administrativeCase);
    }

    const updatedCase = await this.prisma.administrativeCase.update({
      where: { id: administrativeCase.id },
      data: { status: "WAITING_FOR_USER_DOCUMENTS" },
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

    const requiredDocuments = readRequiredDocuments(administrativeCase.gameRule?.requiredDocuments);
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
    documents: { include: { document: { select: { id: true, kind: true, originalName: true, uploadedAt: true } } } },
    payment: { select: { status: true, paidAt: true } },
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

    const requiredDocuments = readRequiredDocuments(gameRule.requiredDocuments);
    const attachedKinds = new Set<string>(administrativeCase.documents.map((caseDocument) => caseDocument.document.kind));
    const required = requiredDocuments.map((document) => ({
      ...document,
      supplied: attachedKinds.has(document.kind),
    }));

    return {
      ...this.presentCase(administrativeCase),
      rule: {
        id: gameRule.id,
        name: gameRule.name,
        organizer: gameRule.organizer.name,
      },
      requiredDocuments: required,
      missingDocuments: required.filter((document) => document.required && !document.supplied),
      attachedDocuments: administrativeCase.documents.map((caseDocument) => ({
        id: caseDocument.document.id,
        kind: caseDocument.document.kind,
        originalName: caseDocument.document.originalName,
        uploadedAt: caseDocument.document.uploadedAt,
      })),
      payment: administrativeCase.payment
        ? { status: administrativeCase.payment.status, paidAt: administrativeCase.payment.paidAt }
        : null,
    };
  }

  private missingDocuments(administrativeCase: Awaited<ReturnType<EligibilityService["findOwnedCase"]>>) {
    return this.presentCaseDetail(administrativeCase).missingDocuments;
  }

  private presentCase(administrativeCase: {
    id: string;
    status: string;
    estimatedRecoverableCents: number;
    serviceFeeCents: number;
    confidence: Prisma.Decimal | null;
    complianceSnapshotJson: Prisma.JsonValue;
    createdAt: Date;
  }) {
    return {
      id: administrativeCase.id,
      status: administrativeCase.status,
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

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? {} : JSON.parse(serialized) as Prisma.InputJsonValue;
}

function readRequiredDocuments(value: Prisma.JsonValue | null | undefined): Array<{ kind: string; label: string; required: boolean }> {
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
