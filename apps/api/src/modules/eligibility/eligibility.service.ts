import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { AnalyzeOrangeInvoiceEligibility } from "@lydoc/application";
import { DocumentKind, DocumentStatus, Prisma, RuleStatus } from "@prisma/client";
import { LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class EligibilityService {
  private readonly analyzer = new AnalyzeOrangeInvoiceEligibility();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
  ) {}

  async analyzeInvoice(documentId: string, ownerId: string) {
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!document) {
      throw new NotFoundException("Document introuvable.");
    }

    if (document.kind !== DocumentKind.ORANGE_INVOICE) {
      throw new BadRequestException("Seules les factures Orange peuvent etre analysees ici.");
    }

    const bytes = await this.storage.getDecryptedObject({
      object: {
        bucket: document.storageBucket,
        key: document.storageKey,
        checksumSha256: document.checksumSha256,
        sizeBytes: document.sizeBytes,
      },
      encryptionContext: { ownerId, documentKind: document.kind },
    });
    const rules = await this.prisma.gameRule.findMany({
      where: { status: RuleStatus.APPROVED },
      include: { organizer: true },
    });
    const analysis = this.analyzer.execute({
      bytes,
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
          provider: "local-printable-text",
          text: analysis.extractedText,
          rawJson: {
            isOrangeInvoice: analysis.isOrangeInvoice,
            participationCount: analysis.participationCount,
          },
        },
        update: {
          provider: "local-printable-text",
          text: analysis.extractedText,
          rawJson: {
            isOrangeInvoice: analysis.isOrangeInvoice,
            participationCount: analysis.participationCount,
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
}
