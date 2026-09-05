import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AnalyzeTelecomInvoiceEligibility } from "@lydoc/application";
import {
  DocumentKind,
  DocumentStatus,
  Prisma,
  RuleStatus,
} from "@prisma/client";
import {
  EncryptedSensitiveTextProvider,
  LocalEncryptedObjectStorageProvider,
} from "@lydoc/infrastructure";
import { MistralOcrProvider } from "@lydoc/infrastructure";
import {
  documentRequirementShortName,
  findMissingDocumentRequirements,
  isDocumentRequirementSupplied,
  readDocumentRequirements,
} from "../documents/document-requirements";
import { missingCustomerProfileFields } from "../identity/customer-profile";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { requireDocumentEligibleForAi } from "../../platform/ai-document-policy";
import { requireManagedPostalEnabled } from "../../platform/feature-flags";
import {
  LocalPdfDlpBusyError,
  LocalPdfDlpService,
  LocalPdfDlpUnavailableError,
} from "../../platform/local-pdf-dlp.service";
import {
  lockCustomerProfile,
  lockDocumentLifecycle,
  lockGameRule,
  lockGeneratedPacketCase,
  lockStripeCheckoutCase,
} from "../../platform/transaction-locks";
import {
  canRequestPostalExpenseReimbursement,
  readPostalExpenseReimbursement,
} from "../rules/postal-expense-reimbursement";
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
  private readonly analyzer = new AnalyzeTelecomInvoiceEligibility();
  private readonly mistralOcr = new MistralOcrProvider(
    process.env.MISTRAL_API_KEY ?? "",
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
    private readonly notifications: NotificationsService,
    private readonly sensitiveText: EncryptedSensitiveTextProvider = new EncryptedSensitiveTextProvider(),
    private readonly localPdfDlp: LocalPdfDlpService = new LocalPdfDlpService(),
  ) {}

  async analyzeInvoice(
    documentId: string,
    ownerId: string,
    gameRuleId: string,
    aiProcessingConsentAccepted = false,
  ) {
    if (!aiProcessingConsentAccepted) {
      throw new BadRequestException(
        "Votre accord explicite est requis avant toute analyse par le fournisseur d'IA.",
      );
    }
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        ownerId,
        deletedAt: null,
        owner: { is: { accountDeletedAt: null } },
      },
      include: {
        ocrResult: true,
        caseDocuments: {
          where: { purpose: "SOURCE_INVOICE" },
          select: { caseId: true },
        },
      },
    });

    if (!document) {
      throw new NotFoundException("Document introuvable.");
    }

    if (document.kind !== DocumentKind.ORANGE_INVOICE) {
      throw new BadRequestException(
        "Seules les factures operateur peuvent etre analysees ici.",
      );
    }

    if (!gameRuleId.trim()) {
      throw new BadRequestException(
        "Selectionnez la chaine et le jeu concours avant l'analyse.",
      );
    }
    const selectedRule = await this.prisma.gameRule.findFirst({
      where: {
        id: gameRuleId,
        status: RuleStatus.APPROVED,
        sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
      },
      include: { organizer: true },
    });
    if (!selectedRule) {
      throw new BadRequestException(
        "Le jeu selectionne n'est plus disponible.",
      );
    }

    await this.prisma.auditLog.create({
      data: {
        actorId: ownerId,
        action: "AI_DOCUMENT_PROCESSING_CONSENT_RECORDED",
        entityType: "Document",
        entityId: document.id,
        metadata: {
          provider: "mistral",
          purpose: "ORANGE_INVOICE_OCR",
          version: "2026-08-03.mistral.v1",
          acceptedAt: new Date().toISOString(),
        },
      },
    });

    const ocr = document.ocrResult
      ? {
          text: this.sensitiveText.decrypt(
            document.ocrResult.text,
            ocrTextContext(document.id),
          ),
          provider: document.ocrResult.provider,
          ...(document.ocrResult.confidence
            ? { confidence: Number(document.ocrResult.confidence) }
            : {}),
          raw: document.ocrResult.rawJson,
        }
      : await this.runOcr(document, ownerId);
    const analysis = this.analyzer.execute({
      text: ocr.text,
      selectedRuleId: selectedRule.id,
      approvedRules: [
        {
          id: selectedRule.id,
          organizerName: selectedRule.organizer.name,
          name: selectedRule.name,
          reimbursementCents: selectedRule.reimbursementCents,
          requiredDocuments: selectedRule.requiredDocuments,
          constraints: selectedRule.constraintsJson,
          ...(selectedRule.validFrom
            ? { validFrom: selectedRule.validFrom }
            : {}),
          ...(selectedRule.validUntil
            ? { validUntil: selectedRule.validUntil }
            : {}),
        },
      ],
    });
    const candidate = analysis.candidates[0];
    const matchedRule =
      candidate?.ruleId === selectedRule.id ? selectedRule : undefined;
    if (candidate && !matchedRule) {
      throw new BadRequestException(
        "Le reglement identifie n'est plus disponible.",
      );
    }

    const initiallyKnownCaseIds = [
      ...new Set(document.caseDocuments.map(({ caseId }) => caseId)),
    ].sort((left, right) => left.localeCompare(right));
    const result = await this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await lockGameRule(transaction, selectedRule.id);
      for (const existingCaseId of initiallyKnownCaseIds) {
        await lockStripeCheckoutCase(transaction, existingCaseId);
        await lockGeneratedPacketCase(transaction, existingCaseId);
      }
      await lockDocumentLifecycle(transaction, document.id);
      const activeDocument = await transaction.document.findFirst({
        where: {
          id: document.id,
          ownerId,
          deletedAt: null,
          owner: { is: { accountDeletedAt: null } },
        },
        select: { id: true },
      });
      if (!activeDocument) {
        throw new NotFoundException("Document introuvable.");
      }
      const currentSelectedRule = await transaction.gameRule.findFirst({
        where: {
          id: selectedRule.id,
          status: RuleStatus.APPROVED,
          version: selectedRule.version,
          sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
        },
        select: { id: true },
      });
      if (!currentSelectedRule) {
        throw new BadRequestException(
          "Le reglement selectionne a change pendant l'analyse. Relancez-la avec sa version actuelle.",
        );
      }
      await transaction.ocrResult.upsert({
        where: { documentId: document.id },
        create: {
          documentId: document.id,
          provider: ocr.provider,
          text: this.sensitiveText.encrypt(
            ocr.text,
            ocrTextContext(document.id),
          ),
          ...(ocr.confidence === undefined
            ? {}
            : { confidence: ocr.confidence }),
          rawJson: {
            isOrangeInvoice: analysis.isOrangeInvoice,
            isTelecomInvoice: analysis.isTelecomInvoice,
            operatorName: analysis.operatorName ?? null,
            participationCount: analysis.participationCount,
            detectedSmsCharges: analysis.detectedSmsCharges,
            selectedGameRuleId: selectedRule.id,
            selectionSource: "CUSTOMER",
            provider: ocr.provider,
            ocr: toJsonValue(ocr.raw),
          },
        },
        update: {
          provider: ocr.provider,
          text: this.sensitiveText.encrypt(
            ocr.text,
            ocrTextContext(document.id),
          ),
          ...(ocr.confidence === undefined
            ? {}
            : { confidence: ocr.confidence }),
          rawJson: {
            isOrangeInvoice: analysis.isOrangeInvoice,
            isTelecomInvoice: analysis.isTelecomInvoice,
            operatorName: analysis.operatorName ?? null,
            participationCount: analysis.participationCount,
            detectedSmsCharges: analysis.detectedSmsCharges,
            selectedGameRuleId: selectedRule.id,
            selectionSource: "CUSTOMER",
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
        include: {
          case: {
            include: {
              gameRule: { select: { status: true } },
              documents: {
                include: {
                  document: {
                    select: {
                      kind: true,
                      watermarked: true,
                    },
                  },
                },
              },
              payment: { select: { status: true } },
            },
          },
        },
      });
      if (existingCaseDocument) {
        if (!initiallyKnownCaseIds.includes(existingCaseDocument.caseId)) {
          throw new BadRequestException(
            "Le document vient d'etre rattache a un dossier. Relancez l'analyse.",
          );
        }
        const existingCase = existingCaseDocument.case;
        if (!candidate || !matchedRule) {
          return null;
        }
        const canRefreshCase =
          ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
            existingCase.status,
          ) &&
          !existingCase.validatedAt &&
          !existingCase.payment;
        if (!canRefreshCase && existingCase.gameRuleId !== candidate.ruleId) {
          throw new BadRequestException(
            "Ce dossier est deja valide avec un autre jeu concours.",
          );
        }
        if (!canRefreshCase) {
          return existingCase;
        }

        const ruleSnapshot = createCaseRuleSnapshot(matchedRule);
        const attachedKinds = new Set(
          existingCase.documents
            .filter(({ document }) => isUsableCaseDocument(document))
            .map(({ document }) => document.kind),
        );
        const missingRequirements = missingRequiredDocumentLabels(
          ruleSnapshot.requiredDocuments,
          attachedKinds,
        );
        const previousRuleId = existingCase.gameRuleId;
        const updatedCase = await transaction.administrativeCase.update({
          where: { id: existingCase.id },
          data: {
            gameRuleId: candidate.ruleId,
            status:
              existingCase.status === "DRAFT"
                ? "DRAFT"
                : missingRequirements.length > 0
                  ? "WAITING_FOR_USER_DOCUMENTS"
                  : "READY_TO_PAY",
            estimatedRecoverableCents: candidate.reimbursementCents,
            confidence: candidate.confidence,
            complianceSnapshotJson: {
              evidence: candidate.evidence,
              detectedSmsCharges: candidate.detectedSmsCharges,
              missingRequirements,
              ruleSnapshot,
            } as Prisma.InputJsonValue,
          },
        });
        await transaction.auditLog.create({
          data: {
            actorId: ownerId,
            action:
              existingCase.gameRuleId === candidate.ruleId
                ? "CASE_DETECTION_REFRESHED"
                : "CASE_RULE_REASSIGNED_AFTER_ANALYSIS",
            entityType: "AdministrativeCase",
            entityId: existingCase.id,
            metadata: {
              previousRuleId,
              ruleId: candidate.ruleId,
              documentId: document.id,
            },
          },
        });
        return updatedCase;
      }

      if (!candidate) {
        await transaction.auditLog.create({
          data: {
            actorId: ownerId,
            action: "INVOICE_ANALYZED_WITH_SELECTED_GAME_NO_MATCH",
            entityType: "Document",
            entityId: document.id,
            metadata: {
              gameRuleId: selectedRule.id,
              detectedSmsCount: analysis.participationCount,
            },
          },
        });
        return null;
      }

      if (!matchedRule) {
        throw new BadRequestException(
          "Le reglement identifie n'est plus disponible.",
        );
      }
      const ruleSnapshot = createCaseRuleSnapshot(matchedRule);
      const missingRequirements = missingRequiredDocumentLabels(
        ruleSnapshot.requiredDocuments,
        new Set([document.kind]),
      );

      const createdCase = await transaction.administrativeCase.create({
        data: {
          ownerId,
          gameRuleId: candidate.ruleId,
          estimatedRecoverableCents: candidate.reimbursementCents,
          confidence: candidate.confidence,
          complianceSnapshotJson: {
            evidence: candidate.evidence,
            detectedSmsCharges: candidate.detectedSmsCharges,
            missingRequirements,
            ruleSnapshot,
          } as Prisma.InputJsonValue,
          documents: {
            create: { documentId: document.id, purpose: "SOURCE_INVOICE" },
          },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_CREATED_FROM_SELECTED_GAME",
          entityType: "AdministrativeCase",
          entityId: createdCase.id,
          metadata: { documentId: document.id, gameRuleId: candidate.ruleId },
        },
      });
      return createdCase;
    });

    return {
      document: {
        id: document.id,
        isOrangeInvoice: analysis.isOrangeInvoice,
        isTelecomInvoice: analysis.isTelecomInvoice,
        operatorName: analysis.operatorName ?? null,
        participationCount:
          candidate?.detectedSmsCharges.reduce(
            (total, charge) => total + charge.quantity,
            0,
          ) ?? 0,
        detectedSmsCharges: candidate?.detectedSmsCharges ?? [],
      },
      candidates: analysis.candidates,
      case: result ? this.presentCase(result) : null,
    };
  }

  async listCases(ownerId: string) {
    const cases = await this.prisma.administrativeCase.findMany({
      where: { ownerId, owner: { accountDeletedAt: null } },
      include: { gameRule: { include: { organizer: true } } },
      orderBy: { updatedAt: "desc" },
    });

    return cases.map((administrativeCase) => ({
      ...this.presentCase(administrativeCase),
      rule: administrativeCase.gameRule
        ? (() => {
            const snapshot =
              readRuleSnapshotFromCompliance(
                administrativeCase.complianceSnapshotJson,
              ) ?? createCaseRuleSnapshot(administrativeCase.gameRule);
            return {
              id: snapshot.ruleId,
              name: snapshot.name,
              organizer: snapshot.organizerName,
            };
          })()
        : null,
    }));
  }

  async getCase(caseId: string, ownerId: string) {
    const administrativeCase = await this.findOwnedCase(caseId, ownerId);
    return this.presentCaseDetail(administrativeCase);
  }

  async updateDetection(
    caseId: string,
    smsCount: number | undefined,
    amountCents: number | undefined,
    ownerId: string,
  ) {
    if (
      !Number.isInteger(smsCount) ||
      (smsCount ?? 0) < 1 ||
      (smsCount ?? 0) > 1_000
    ) {
      throw new BadRequestException(
        "Le nombre de SMS doit etre un entier compris entre 1 et 1000.",
      );
    }
    if (
      !Number.isInteger(amountCents) ||
      (amountCents ?? 0) < 1 ||
      (amountCents ?? 0) > 10_000_000
    ) {
      throw new BadRequestException(
        "Le montant doit etre compris entre 0,01 EUR et 100 000 EUR.",
      );
    }

    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const administrativeCase = await this.lockAndFindOwnedCase(
        transaction,
        caseId,
        ownerId,
      );
      if (administrativeCase.validatedAt || administrativeCase.payment) {
        throw new BadRequestException(
          "La detection ne peut plus etre modifiee apres validation ou lancement du paiement.",
        );
      }
      if (
        !["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
          administrativeCase.status,
        )
      ) {
        throw new BadRequestException("Ce dossier ne peut plus etre modifie.");
      }
      if (
        (await transaction.generatedPacket.count({ where: { caseId } })) > 0
      ) {
        throw new BadRequestException("Ce dossier a deja ete genere.");
      }

      const compliance = readJsonObject(
        administrativeCase.complianceSnapshotJson,
      );
      const currentCharges = readJsonArray(compliance.detectedSmsCharges);
      const existingReview = readJsonObject(compliance.detectionReview);
      const originalDetectedSmsCharges = readJsonArray(
        existingReview.originalDetectedSmsCharges,
      );
      const sourceCharges =
        originalDetectedSmsCharges.length > 0
          ? originalDetectedSmsCharges
          : currentCharges;
      const codes = uniqueTextValues(currentCharges, "code");
      const dates = uniqueTextValues(currentCharges, "occurredOn");
      const correctedCharge = {
        label: `Correction client : ${smsCount} SMS pour ${(amountCents! / 100).toFixed(2)} EUR`,
        quantity: smsCount!,
        amountCents: amountCents!,
        evidence: "Nombre de SMS et montant verifies par le client",
        ...(codes.length === 1 ? { code: codes[0] } : {}),
        ...(dates.length === 1 ? { occurredOn: dates[0] } : {}),
      };
      const correctedAt = new Date();
      const changed = await transaction.administrativeCase.updateMany({
        where: {
          id: administrativeCase.id,
          ownerId,
          validatedAt: null,
          status: {
            in: ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"],
          },
          payment: { is: null },
          generatedPackets: { none: {} },
        },
        data: {
          estimatedRecoverableCents: amountCents!,
          complianceSnapshotJson: toJsonValue({
            ...compliance,
            detectedSmsCharges: [correctedCharge],
            detectionReview: {
              source: "CUSTOMER_CONFIRMED",
              correctedAt: correctedAt.toISOString(),
              smsCount,
              amountCents,
              originalDetectedSmsCharges: sourceCharges,
            },
          }),
        },
      });
      if (changed.count !== 1) {
        throw new BadRequestException(
          "Le dossier a change. Rechargez-le avant de corriger la detection.",
        );
      }
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_SMS_DETECTION_CORRECTED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: {
            previousSmsCount: readDetectedSmsCount(
              administrativeCase.complianceSnapshotJson,
            ),
            previousAmountCents: administrativeCase.estimatedRecoverableCents,
            smsCount,
            amountCents,
          },
        },
      });
      const updated = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!updated) throw new NotFoundException("Dossier introuvable.");
      return updated;
    });

    return this.presentCaseDetail(updatedCase);
  }

  async updatePostalExpenseClaim(
    caseId: string,
    requested: boolean | undefined,
    ownerId: string,
  ) {
    if (typeof requested !== "boolean") {
      throw new BadRequestException("Le choix de remboursement est invalide.");
    }

    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const administrativeCase = await this.lockAndFindOwnedCase(
        transaction,
        caseId,
        ownerId,
      );
      if (administrativeCase.validatedAt || administrativeCase.payment) {
        throw new BadRequestException(
          "Ce choix ne peut plus etre modifie apres la validation finale.",
        );
      }
      if (
        !["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"].includes(
          administrativeCase.status,
        )
      ) {
        throw new BadRequestException("Ce dossier ne peut plus etre modifie.");
      }
      if (
        (await transaction.generatedPacket.count({ where: { caseId } })) > 0
      ) {
        throw new BadRequestException("Ce dossier a deja ete genere.");
      }

      const ruleSnapshot = this.ruleSnapshot(administrativeCase);
      const terms = readPostalExpenseReimbursement(
        ruleSnapshot.constraints.postalExpenseReimbursement,
      );
      if (requested && !canRequestPostalExpenseReimbursement(terms)) {
        throw new BadRequestException(
          "Le reglement ne permet pas de demander ces frais avec ce dossier.",
        );
      }
      const compliance = readJsonObject(
        administrativeCase.complianceSnapshotJson,
      );
      const selectedAt = requested ? new Date().toISOString() : null;
      const changed = await transaction.administrativeCase.updateMany({
        where: {
          id: administrativeCase.id,
          ownerId,
          validatedAt: null,
          status: {
            in: ["DRAFT", "WAITING_FOR_USER_DOCUMENTS", "READY_TO_PAY"],
          },
          payment: { is: null },
          generatedPackets: { none: {} },
        },
        data: {
          complianceSnapshotJson: toJsonValue({
            ...compliance,
            postalExpenseClaim: { requested, selectedAt },
          }),
        },
      });
      if (changed.count !== 1) {
        throw new BadRequestException(
          "Le dossier a change. Rechargez-le avant de modifier ce choix.",
        );
      }
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_POSTAL_EXPENSE_CLAIM_UPDATED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: {
            requested,
            ruleId: ruleSnapshot.ruleId,
            claimLimitScope: terms.claimLimit.scope,
          },
        },
      });
      const updated = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!updated) throw new NotFoundException("Dossier introuvable.");
      return updated;
    });

    return this.presentCaseDetail(updatedCase);
  }

  async confirmCase(caseId: string, ownerId: string) {
    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const administrativeCase = await this.lockAndFindOwnedCase(
        transaction,
        caseId,
        ownerId,
      );
      const existingValidation = readCaseValidationSnapshot(
        administrativeCase.validationSnapshotJson,
      );
      if (
        administrativeCase.validatedAt &&
        existingValidation &&
        administrativeCase.payment
      ) {
        return administrativeCase;
      }
      if (
        administrativeCase.payment ||
        administrativeCase.status !== "READY_TO_PAY"
      ) {
        throw new BadRequestException(
          "Reunissez toutes les pieces avant de valider le dossier.",
        );
      }
      if (
        (await transaction.generatedPacket.count({ where: { caseId } })) > 0
      ) {
        throw new BadRequestException("Ce dossier a deja ete genere.");
      }
      const missingDocuments = this.missingDocuments(administrativeCase);
      if (missingDocuments.length > 0) {
        throw new BadRequestException(
          `Ajoutez les pièces manquantes : ${missingDocuments.map((item) => documentRequirementShortName(item.kind)).join(", ")}.`,
        );
      }
      const missingProfileFields = missingCustomerProfileFields(
        administrativeCase.owner,
      );
      if (missingProfileFields.length > 0) {
        throw new BadRequestException(
          `Completez votre profil avant la validation : ${missingProfileFields.join(", ")}.`,
        );
      }

      const confirmedAt = new Date();
      const ruleSnapshot = this.ruleSnapshot(administrativeCase);
      const postalExpenseTerms = readPostalExpenseReimbursement(
        ruleSnapshot.constraints.postalExpenseReimbursement,
      );
      const postalExpenseSelection = readPostalExpenseClaimSelection(
        administrativeCase.complianceSnapshotJson,
      );
      const postalExpenseRequested =
        postalExpenseSelection.requested &&
        canRequestPostalExpenseReimbursement(postalExpenseTerms);
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
        postalExpenseClaim: {
          requested: postalExpenseRequested,
          selectedAt: postalExpenseRequested
            ? (postalExpenseSelection.selectedAt ?? confirmedAt.toISOString())
            : null,
          terms: postalExpenseTerms,
        },
      };
      const changed = await transaction.administrativeCase.updateMany({
        where: {
          id: administrativeCase.id,
          ownerId,
          status: "READY_TO_PAY",
          payment: { is: null },
          generatedPackets: { none: {} },
        },
        data: {
          validatedAt: confirmedAt,
          validationSnapshotJson: validationSnapshot as Prisma.InputJsonValue,
          complianceSnapshotJson: addRuleSnapshotToCompliance(
            administrativeCase.complianceSnapshotJson,
            ruleSnapshot,
          ) as Prisma.InputJsonValue,
        },
      });
      if (changed.count !== 1) {
        throw new BadRequestException(
          "Le dossier a change. Rechargez-le avant de le valider.",
        );
      }
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_VALIDATED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: {
            ruleId: ruleSnapshot.ruleId,
            ruleVersion: ruleSnapshot.version,
          },
        },
      });
      const updated = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!updated) throw new NotFoundException("Dossier introuvable.");
      return updated;
    });

    await this.notifications.sendCaseEvent(caseId, "CASE_VALIDATED");
    return this.presentCaseDetail(updatedCase);
  }

  async deleteCase(caseId: string, ownerId: string) {
    const outcome = await this.prisma.$transaction(async (transaction) => {
      // Every multi-lock caller uses this order to prevent deadlocks.
      await lockCustomerProfile(transaction, ownerId);
      await lockStripeCheckoutCase(transaction, caseId);
      await lockGeneratedPacketCase(transaction, caseId);
      const administrativeCase = await transaction.administrativeCase.findFirst(
        {
          where: {
            id: caseId,
            ownerId,
            owner: { accountDeletedAt: null },
          },
          select: {
            id: true,
            status: true,
            payment: { select: { status: true } },
            postalShipment: {
              select: { status: true, providerUid: true },
            },
            _count: { select: { generatedPackets: true } },
          },
        },
      );
      if (!administrativeCase) {
        return { state: "NOT_FOUND" as const };
      }

      const blockedReason = caseDeletionBlockReason({
        status: administrativeCase.status,
        paymentStatus: administrativeCase.payment?.status ?? null,
        postalShipmentStatus: administrativeCase.postalShipment?.status ?? null,
        postalProviderUid:
          administrativeCase.postalShipment?.providerUid ?? null,
        generatedPacketCount: administrativeCase._count.generatedPackets,
      });
      if (blockedReason) {
        await transaction.auditLog.create({
          data: {
            actorId: ownerId,
            action: "CASE_DELETION_BLOCKED",
            entityType: "AdministrativeCase",
            entityId: administrativeCase.id,
            metadata: {
              reason: blockedReason,
              status: administrativeCase.status,
              paymentStatus: administrativeCase.payment?.status ?? null,
              postalShipmentStatus:
                administrativeCase.postalShipment?.status ?? null,
              generatedPacketCount: administrativeCase._count.generatedPackets,
            },
          },
        });
        return { state: "BLOCKED" as const };
      }

      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_DELETION_REQUESTED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: {
            status: administrativeCase.status,
            paymentStatus: administrativeCase.payment?.status ?? null,
            postalShipmentStatus:
              administrativeCase.postalShipment?.status ?? null,
          },
        },
      });
      await transaction.postalShipment.deleteMany({
        where: { caseId: administrativeCase.id },
      });
      await transaction.payment.deleteMany({
        where: { caseId: administrativeCase.id },
      });
      await transaction.notificationDelivery.deleteMany({
        where: { caseId: administrativeCase.id },
      });
      await transaction.caseDocument.deleteMany({
        where: { caseId: administrativeCase.id },
      });
      await transaction.administrativeCase.delete({
        where: { id: administrativeCase.id },
      });
      return { state: "DELETED" as const };
    });

    if (outcome.state === "NOT_FOUND") {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (outcome.state === "BLOCKED") {
      throw new BadRequestException(
        "Ce dossier a deja ete genere, paye ou pris en charge, ou un paiement est encore ouvert. Il doit etre conserve pour assurer sa tracabilite.",
      );
    }

    return true;
  }

  async markRefunded(caseId: string, ownerId: string) {
    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const administrativeCase = await this.lockAndFindOwnedCase(
        transaction,
        caseId,
        ownerId,
      );
      if (administrativeCase.status === "REFUNDED") {
        return administrativeCase;
      }
      const refundBlockReason = caseRefundBlockReason({
        status: administrativeCase.status,
        paymentStatus: administrativeCase.payment?.status ?? null,
        postalShipmentStatus: administrativeCase.postalShipment?.status ?? null,
      });
      if (refundBlockReason === "PAYMENT_PENDING") {
        throw new BadRequestException(
          "Un paiement Stripe est encore ouvert pour ce dossier.",
        );
      }
      if (refundBlockReason?.startsWith("CASE_STATUS_")) {
        throw new BadRequestException(
          "Ce dossier cloture ne peut pas etre marque comme rembourse.",
        );
      }
      if (refundBlockReason) {
        throw new BadRequestException(
          "Ce dossier est deja en cours de traitement postal et ne peut pas etre marque comme rembourse.",
        );
      }
      if (
        !administrativeCase.validatedAt ||
        !administrativeCase.fulfillmentMode
      ) {
        throw new BadRequestException(
          "Finalisez le dossier avant de confirmer son remboursement.",
        );
      }
      const changed = await transaction.administrativeCase.updateMany({
        where: {
          id: administrativeCase.id,
          ownerId,
          status: { notIn: ["REJECTED", "CANCELLED", "REFUNDED"] },
          AND: [
            {
              OR: [
                { payment: { is: null } },
                { payment: { is: { status: { not: "PENDING" } } } },
              ],
            },
            {
              OR: [
                { postalShipment: { is: null } },
                {
                  postalShipment: {
                    is: { status: { not: "SUBMITTING" } },
                  },
                },
              ],
            },
          ],
        },
        data: { status: "REFUNDED" },
      });
      if (changed.count !== 1) {
        throw new BadRequestException(
          "Le dossier a change. Rechargez-le avant de confirmer son remboursement.",
        );
      }
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_REFUND_CONFIRMED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: {
            estimatedRecoverableCents:
              administrativeCase.estimatedRecoverableCents,
          },
        },
      });
      const updated = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!updated) throw new NotFoundException("Dossier introuvable.");
      return updated;
    });

    await this.notifications.sendCaseEvent(caseId, "REFUND_CONFIRMED");
    return this.presentCaseDetail(updatedCase);
  }

  async markSent(caseId: string, ownerId: string) {
    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const administrativeCase = await this.lockAndFindOwnedCase(
        transaction,
        caseId,
        ownerId,
      );
      if (administrativeCase.status === "SENT") return administrativeCase;
      if (
        administrativeCase.fulfillmentMode !== "SELF_SERVICE" ||
        !administrativeCase.validatedAt
      ) {
        throw new BadRequestException(
          "Seul un dossier finalise et envoye par vos soins peut etre marque comme envoye.",
        );
      }
      if (!["GENERATED", "PRINT_READY"].includes(administrativeCase.status)) {
        throw new BadRequestException(
          "Ce dossier ne peut pas etre marque comme envoye.",
        );
      }
      const changed = await transaction.administrativeCase.updateMany({
        where: {
          id: administrativeCase.id,
          ownerId,
          fulfillmentMode: "SELF_SERVICE",
          status: { in: ["GENERATED", "PRINT_READY"] },
        },
        data: { status: "SENT" },
      });
      if (changed.count !== 1) {
        throw new BadRequestException(
          "Le dossier a change. Rechargez-le avant de confirmer son envoi.",
        );
      }
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_SENT_CONFIRMED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: { fulfillmentMode: "SELF_SERVICE" },
        },
      });
      const updated = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!updated) throw new NotFoundException("Dossier introuvable.");
      return updated;
    });

    return this.presentCaseDetail(updatedCase);
  }

  async chooseFulfillment(caseId: string, mode: string, ownerId: string) {
    if (!["SELF_SERVICE", "MANAGED_POSTAL"].includes(mode)) {
      throw new BadRequestException(
        "Choisissez le téléchargement gratuit ou l'envoi pris en charge.",
      );
    }

    if (mode === "MANAGED_POSTAL") {
      requireManagedPostalEnabled();
    }

    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await lockStripeCheckoutCase(transaction, caseId);
      await lockGeneratedPacketCase(transaction, caseId);
      const administrativeCase = await transaction.administrativeCase.findFirst(
        {
          where: {
            id: caseId,
            ownerId,
            owner: { accountDeletedAt: null },
          },
          include: this.caseDetailIncludes,
        },
      );
      if (!administrativeCase) {
        throw new NotFoundException("Dossier introuvable.");
      }
      if (!administrativeCase.gameRule) {
        throw new BadRequestException(
          "Ce dossier n'est associe a aucun reglement.",
        );
      }
      if (
        (await transaction.generatedPacket.count({ where: { caseId } })) > 0
      ) {
        throw new BadRequestException(
          "Le mode d'envoi ne peut plus etre modifie apres la generation du dossier.",
        );
      }
      if (
        !administrativeCase.validatedAt ||
        !readCaseValidationSnapshot(administrativeCase.validationSnapshotJson)
      ) {
        throw new BadRequestException(
          "Validez le récapitulatif avant de choisir votre mode d'envoi.",
        );
      }
      if (
        ["GENERATED", "PAID", "PRINT_READY", "SENT", "REFUNDED"].includes(
          administrativeCase.status,
        )
      ) {
        throw new BadRequestException(
          "Le mode d'envoi ne peut plus etre modifie apres la generation du dossier.",
        );
      }
      if (
        administrativeCase.payment?.status === "PAID" ||
        administrativeCase.payment?.status === "REFUNDED"
      ) {
        throw new BadRequestException(
          "Le mode d'envoi ne peut plus être modifié après le paiement.",
        );
      }
      if (
        mode === "SELF_SERVICE" &&
        administrativeCase.payment?.status === "PENDING"
      ) {
        throw new BadRequestException(
          "Un paiement Stripe est encore ouvert. Attendez sa confirmation ou son expiration avant de choisir le telechargement gratuit.",
        );
      }
      if (
        administrativeCase.postalShipment &&
        !["DRAFT", "QUOTED", "FAILED", "CANCELLED"].includes(
          administrativeCase.postalShipment.status,
        )
      ) {
        throw new BadRequestException(
          "Le mode d'envoi ne peut plus être modifié après sa prise en charge.",
        );
      }

      if (mode === "SELF_SERVICE") {
        await transaction.payment.deleteMany({
          where: { caseId, status: "FAILED" },
        });
        await transaction.postalShipment.deleteMany({
          where: {
            caseId,
            status: { in: ["DRAFT", "QUOTED", "FAILED", "CANCELLED"] },
          },
        });
      }
      const updated = await transaction.administrativeCase.update({
        where: { id: caseId },
        data: {
          fulfillmentMode: mode as "SELF_SERVICE" | "MANAGED_POSTAL",
          ...(mode === "MANAGED_POSTAL" &&
          administrativeCase.status === "GENERATED"
            ? { status: "READY_TO_PAY" as const }
            : {}),
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
    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      const administrativeCase = await this.lockAndFindOwnedCase(
        transaction,
        caseId,
        ownerId,
      );
      if (administrativeCase.status !== "DRAFT") {
        return administrativeCase;
      }

      const nextStatus =
        this.missingDocuments(administrativeCase).length > 0
          ? ("WAITING_FOR_USER_DOCUMENTS" as const)
          : ("READY_TO_PAY" as const);
      const changed = await transaction.administrativeCase.updateMany({
        where: {
          id: administrativeCase.id,
          ownerId,
          status: "DRAFT",
          payment: { is: null },
          generatedPackets: { none: {} },
        },
        data: { status: nextStatus },
      });
      if (changed.count !== 1) {
        throw new BadRequestException(
          "Le dossier a change. Rechargez-le avant de continuer.",
        );
      }
      const updated = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!updated) throw new NotFoundException("Dossier introuvable.");
      return updated;
    });
    return this.presentCaseDetail(updatedCase);
  }

  async attachDocument(caseId: string, documentId: string, ownerId: string) {
    const updatedCase = await this.prisma.$transaction(async (transaction) => {
      await lockCustomerProfile(transaction, ownerId);
      await lockStripeCheckoutCase(transaction, caseId);
      await lockGeneratedPacketCase(transaction, caseId);
      await lockDocumentLifecycle(transaction, documentId);
      const administrativeCase = await transaction.administrativeCase.findFirst(
        {
          where: {
            id: caseId,
            ownerId,
            owner: { accountDeletedAt: null },
          },
          include: this.caseDetailIncludes,
        },
      );
      if (!administrativeCase) {
        throw new NotFoundException("Dossier introuvable.");
      }
      if (!administrativeCase.gameRule) {
        throw new BadRequestException(
          "Ce dossier n'est associe a aucun reglement.",
        );
      }
      const generatedPacketCount = await transaction.generatedPacket.count({
        where: { caseId },
      });
      const blockedReason = caseAttachmentBlockReason({
        status: administrativeCase.status,
        paymentStatus: administrativeCase.payment?.status ?? null,
        generatedPacketCount,
      });
      if (blockedReason) {
        throw new BadRequestException(
          "Les pieces de ce dossier sont gelees et ne peuvent plus etre remplacees.",
        );
      }

      const document = await transaction.document.findFirst({
        where: { id: documentId, ownerId, deletedAt: null },
      });
      if (!document) {
        throw new NotFoundException("Piece introuvable.");
      }
      const requiredDocuments = readDocumentRequirements(
        this.ruleSnapshot(administrativeCase).requiredDocuments,
      );
      const requestedDocument = requiredDocuments.find(
        (item) => item.kind === document.kind,
      );
      if (!requestedDocument) {
        throw new BadRequestException(
          "Cette piece n'est pas prevue par ce dossier.",
        );
      }
      const purpose = `${requestedDocument.required ? "REQUIRED" : "OPTIONAL"}:${document.kind}`;

      await transaction.caseDocument.deleteMany({
        where: {
          caseId: administrativeCase.id,
          purpose,
          documentId: { not: document.id },
        },
      });
      await transaction.caseDocument.upsert({
        where: {
          caseId_documentId_purpose: {
            caseId: administrativeCase.id,
            documentId: document.id,
            purpose,
          },
        },
        create: {
          caseId: administrativeCase.id,
          documentId: document.id,
          purpose,
        },
        update: {},
      });
      // Replacing a piece invalidates every cancellable artifact derived from
      // the former set. PENDING/PAID payments were rejected above.
      await transaction.payment.deleteMany({
        where: { caseId, status: "FAILED" },
      });
      await transaction.postalShipment.deleteMany({
        where: {
          caseId,
          status: { in: ["DRAFT", "QUOTED", "FAILED", "CANCELLED"] },
        },
      });
      const refreshedCase = await transaction.administrativeCase.findFirst({
        where: { id: caseId, ownerId },
        include: this.caseDetailIncludes,
      });
      if (!refreshedCase?.gameRule) {
        throw new NotFoundException("Dossier introuvable.");
      }
      const missingDocuments = this.missingDocuments(refreshedCase);
      const updated = await transaction.administrativeCase.update({
        where: { id: refreshedCase.id },
        data: {
          status:
            missingDocuments.length === 0
              ? "READY_TO_PAY"
              : "WAITING_FOR_USER_DOCUMENTS",
          validatedAt: null,
          validationSnapshotJson: Prisma.DbNull,
        },
        include: this.caseDetailIncludes,
      });
      await transaction.auditLog.create({
        data: {
          actorId: ownerId,
          action: "CASE_DOCUMENT_ATTACHED_OR_REPLACED",
          entityType: "AdministrativeCase",
          entityId: administrativeCase.id,
          metadata: {
            documentId: document.id,
            kind: document.kind,
            validationInvalidated: true,
          },
        },
      });
      return updated;
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
    documents: {
      where: { document: { deletedAt: null } },
      include: {
        document: {
          select: {
            id: true,
            kind: true,
            originalName: true,
            uploadedAt: true,
            watermarked: true,
          },
        },
      },
    },
    payment: { select: { status: true, paidAt: true } },
    postalShipment: {
      select: {
        provider: true,
        environment: true,
        product: true,
        status: true,
        postageCents: true,
        printingCents: true,
        totalCents: true,
        pricingSnapshotJson: true,
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
      where: { id: caseId, ownerId, owner: { accountDeletedAt: null } },
      include: this.caseDetailIncludes,
    });
    if (!administrativeCase) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (!administrativeCase.gameRule) {
      throw new BadRequestException(
        "Ce dossier n'est associe a aucun reglement.",
      );
    }
    return administrativeCase;
  }

  private async lockAndFindOwnedCase(
    transaction: Prisma.TransactionClient,
    caseId: string,
    ownerId: string,
  ) {
    await lockCustomerProfile(transaction, ownerId);
    await lockStripeCheckoutCase(transaction, caseId);
    await lockGeneratedPacketCase(transaction, caseId);
    const administrativeCase = await transaction.administrativeCase.findFirst({
      where: { id: caseId, ownerId, owner: { accountDeletedAt: null } },
      include: this.caseDetailIncludes,
    });
    if (!administrativeCase) {
      throw new NotFoundException("Dossier introuvable.");
    }
    if (!administrativeCase.gameRule) {
      throw new BadRequestException(
        "Ce dossier n'est associe a aucun reglement.",
      );
    }
    return administrativeCase;
  }

  private presentCaseDetail(
    administrativeCase: Awaited<
      ReturnType<EligibilityService["findOwnedCase"]>
    >,
  ) {
    const gameRule = administrativeCase.gameRule;
    if (!gameRule) {
      throw new BadRequestException(
        "Ce dossier n'est associe a aucun reglement.",
      );
    }

    const ruleSnapshot = this.ruleSnapshot(administrativeCase);
    const validationSnapshot = readCaseValidationSnapshot(
      administrativeCase.validationSnapshotJson,
    );
    const postalExpenseTerms =
      validationSnapshot?.postalExpenseClaim?.terms ??
      readPostalExpenseReimbursement(
        ruleSnapshot.constraints.postalExpenseReimbursement,
      );
    const postalExpenseSelection = readPostalExpenseClaimSelection(
      administrativeCase.complianceSnapshotJson,
    );
    const postalExpenseRequested =
      validationSnapshot?.postalExpenseClaim?.requested ??
      postalExpenseSelection.requested;
    const requiredDocuments = readDocumentRequirements(
      ruleSnapshot.requiredDocuments,
    );
    const attachedKinds = new Set<string>(
      administrativeCase.documents
        .filter(({ document }) => isUsableCaseDocument(document))
        .map(({ document }) => document.kind),
    );
    const required = requiredDocuments.map((document) => {
      const attached = administrativeCase.documents.find(
        ({ document: candidate }) => candidate.kind === document.kind,
      )?.document;
      return {
        ...document,
        supplied: isDocumentRequirementSupplied(document.kind, attachedKinds),
        documentId: attached?.id ?? null,
      };
    });
    const missingProfileFields = missingCustomerProfileFields(
      administrativeCase.owner,
    );

    return {
      ...this.presentCase(administrativeCase),
      rule: {
        id: ruleSnapshot.ruleId,
        version: ruleSnapshot.version,
        name: ruleSnapshot.name,
        organizer: ruleSnapshot.organizerName,
      },
      requiredDocuments: required,
      missingDocuments: required.filter(
        (document) => document.required && !document.supplied,
      ),
      customerProfile: {
        complete: missingProfileFields.length === 0,
        missingFields: missingProfileFields,
      },
      attachedDocuments: administrativeCase.documents.map((caseDocument) => ({
        id: caseDocument.document.id,
        kind: caseDocument.document.kind,
        originalName: caseDocument.document.originalName,
        uploadedAt: caseDocument.document.uploadedAt,
        watermarked: caseDocument.document.watermarked,
      })),
      payment: administrativeCase.payment
        ? {
            status: administrativeCase.payment.status,
            paidAt: administrativeCase.payment.paidAt,
          }
        : null,
      postalShipment: administrativeCase.postalShipment
        ? {
            provider: administrativeCase.postalShipment.provider,
            environment: administrativeCase.postalShipment.environment,
            product: administrativeCase.postalShipment.product,
            status: administrativeCase.postalShipment.status,
            postageCents: administrativeCase.postalShipment.postageCents,
            printingCents:
              administrativeCase.postalShipment.pricingSnapshotJson !== null
                ? administrativeCase.postalShipment.printingCents
                : Math.max(
                    0,
                    administrativeCase.postalShipment.totalCents -
                      administrativeCase.postalShipment.postageCents,
                  ),
            totalCents: administrativeCase.postalShipment.totalCents,
            currency: administrativeCase.postalShipment.currency,
            previewUrl: administrativeCase.postalShipment.previewUrl,
            trackingNumber: administrativeCase.postalShipment.trackingNumber,
            proofOfDepositUrl:
              administrativeCase.postalShipment.proofOfDepositUrl,
            errorMessage: administrativeCase.postalShipment.errorMessage,
            quotedAt: administrativeCase.postalShipment.quotedAt,
            submittedAt: administrativeCase.postalShipment.submittedAt,
            deliveredAt: administrativeCase.postalShipment.deliveredAt,
            simulation:
              administrativeCase.postalShipment.provider === "mock" ||
              administrativeCase.postalShipment.environment !== "production",
          }
        : null,
      validation: administrativeCase.validatedAt
        ? { validatedAt: administrativeCase.validatedAt }
        : null,
      review: {
        reimbursementRecipient:
          readText(ruleSnapshot.constraints.reimbursementRecipient) ||
          ruleSnapshot.organizerName,
        reimbursementAddress: readText(
          ruleSnapshot.constraints.reimbursementAddress,
        ),
        reimbursementDeadline: readText(
          ruleSnapshot.constraints.reimbursementDeadline,
        ),
        detectedSmsCount: readDetectedSmsCount(
          administrativeCase.complianceSnapshotJson,
        ),
        postalExpenseReimbursement: {
          ...postalExpenseTerms,
          available: canRequestPostalExpenseReimbursement(postalExpenseTerms),
          requested:
            postalExpenseRequested &&
            canRequestPostalExpenseReimbursement(postalExpenseTerms),
          selectedAt:
            validationSnapshot?.postalExpenseClaim?.selectedAt ??
            postalExpenseSelection.selectedAt,
          locked: Boolean(validationSnapshot),
        },
      },
    };
  }

  private missingDocuments(
    administrativeCase: Awaited<
      ReturnType<EligibilityService["findOwnedCase"]>
    >,
  ) {
    return this.presentCaseDetail(administrativeCase).missingDocuments;
  }

  private ruleSnapshot(
    administrativeCase: Awaited<
      ReturnType<EligibilityService["findOwnedCase"]>
    >,
  ): CaseRuleSnapshot {
    const existing = readRuleSnapshotFromCompliance(
      administrativeCase.complianceSnapshotJson,
    );
    if (existing) return existing;
    if (!administrativeCase.gameRule) {
      throw new BadRequestException(
        "Ce dossier n'est associe a aucun reglement.",
      );
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
      confidence: administrativeCase.confidence
        ? Number(administrativeCase.confidence)
        : null,
      compliance: administrativeCase.complianceSnapshotJson,
      createdAt: administrativeCase.createdAt,
    };
  }

  private async runOcr(
    document: {
      id: string;
      storageBucket: string;
      storageKey: string;
      checksumSha256: string;
      sizeBytes: number;
      kind: DocumentKind;
      mimeType: string;
    },
    ownerId: string,
  ) {
    requireDocumentEligibleForAi(document.kind);
    const bytes = await this.storage.getDecryptedObject({
      object: {
        bucket: document.storageBucket,
        key: document.storageKey,
        checksumSha256: document.checksumSha256,
        sizeBytes: document.sizeBytes,
      },
      encryptionContext: { ownerId, documentKind: document.kind },
    });

    await this.requireLocallyClassifiedAiDocument({
      bytes,
      declaredKind: document.kind,
      mimeType: document.mimeType,
    });
    await this.reserveMistralCall(ownerId, document.id);
    return this.mistralOcr.extractText({ bytes, mimeType: document.mimeType });
  }

  private async requireLocallyClassifiedAiDocument(input: {
    bytes: Uint8Array;
    declaredKind: DocumentKind;
    mimeType: string;
  }): Promise<void> {
    try {
      const classification = await this.localPdfDlp.classify(input);
      if (classification.accepted) return;
      throw new BadRequestException(
        "Le document visible ne peut pas etre confirme localement comme une facture operateur. Aucune donnee n'a ete transmise au fournisseur d'IA.",
      );
    } catch (error) {
      if (error instanceof LocalPdfDlpBusyError) {
        throw new HttpException(
          "Le controle local des documents est sature. Reessayez dans quelques instants.",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (error instanceof LocalPdfDlpUnavailableError) {
        throw new HttpException(
          "Le controle local de confidentialite est indisponible. Aucune donnee n'a ete transmise.",
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw error;
    }
  }

  private async reserveMistralCall(
    ownerId: string,
    documentId: string,
  ): Promise<void> {
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1_000);
    const day = startOfDay.toISOString().slice(0, 10);
    const limits = aiDailyQuotaLimits(process.env);
    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`mistral-quota:global:${day}`}))
        `;
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`mistral-quota:account:${day}:${ownerId}`}))
        `;
        const providerCount = await transaction.auditLog.count({
          where: {
            action: "MISTRAL_CALL_RESERVED",
            createdAt: { gte: startOfDay, lt: endOfDay },
          },
        });
        if (providerCount >= limits.provider) {
          throw aiQuotaExceeded(
            "Le plafond quotidien du service d'analyse est atteint. Reessayez demain.",
          );
        }
        const accountCount = await transaction.auditLog.count({
          where: {
            actorId: ownerId,
            action: "MISTRAL_CALL_RESERVED",
            createdAt: { gte: startOfDay, lt: endOfDay },
          },
        });
        if (accountCount >= limits.account) {
          throw aiQuotaExceeded(
            "Votre quota quotidien d'analyses est atteint. Reessayez demain.",
          );
        }
        await transaction.auditLog.create({
          data: {
            actorId: ownerId,
            action: "MISTRAL_CALL_RESERVED",
            entityType: "Document",
            entityId: documentId,
            metadata: {
              provider: "mistral",
              purpose: "INVOICE_OCR",
              day,
              accountUsage: accountCount + 1,
              accountLimit: limits.account,
              providerUsage: providerCount + 1,
              providerLimit: limits.provider,
            },
          },
        });
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
  }
}

function ocrTextContext(documentId: string): string {
  return `ocr-result:${documentId}`;
}

export function aiDailyQuotaLimits(
  environment: NodeJS.ProcessEnv,
): Readonly<{ account: number; provider: number }> {
  return {
    account: readNonNegativeInteger(
      environment.AI_DAILY_ACCOUNT_CALL_LIMIT,
      10,
      1_000,
    ),
    provider: readNonNegativeInteger(
      environment.MISTRAL_DAILY_CALL_LIMIT,
      1_000,
      100_000,
    ),
  };
}

function readNonNegativeInteger(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Math.min(Number.parseInt(value, 10), maximum);
}

function aiQuotaExceeded(message: string): HttpException {
  return new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
}

const deletionProtectedCaseStatuses = new Set([
  "GENERATED",
  "PAID",
  "PRINT_READY",
  "SENT",
  "REFUNDED",
]);
const deletionProtectedShipmentStatuses = new Set([
  "SUBMITTING",
  "SUBMITTED",
  "PRODUCED",
  "HANDED_OVER",
  "IN_TRANSIT",
  "DELIVERED",
]);

export function caseDeletionBlockReason(input: {
  status: string;
  paymentStatus: string | null;
  postalShipmentStatus: string | null;
  postalProviderUid: string | null;
  generatedPacketCount: number;
}): string | null {
  if (input.paymentStatus === "PENDING") return "PAYMENT_PENDING";
  if (input.paymentStatus === "PAID") return "PAYMENT_PAID";
  if (input.paymentStatus === "REFUNDED") return "PAYMENT_REFUNDED";
  if (input.generatedPacketCount > 0) return "PACKET_GENERATED";
  if (deletionProtectedCaseStatuses.has(input.status)) {
    return `CASE_STATUS_${input.status}`;
  }
  if (
    input.postalShipmentStatus &&
    deletionProtectedShipmentStatuses.has(input.postalShipmentStatus)
  ) {
    return `SHIPMENT_STATUS_${input.postalShipmentStatus}`;
  }
  if (
    input.postalProviderUid &&
    input.postalShipmentStatus !== "DRAFT" &&
    input.postalShipmentStatus !== "QUOTED" &&
    input.postalShipmentStatus !== "CANCELLED"
  ) {
    return "SHIPMENT_PROVIDER_ACCEPTED";
  }
  return null;
}

const attachmentFrozenCaseStatuses = new Set([
  "GENERATED",
  "PRINT_READY",
  "PAID",
  "SENT",
  "REFUNDED",
  "REJECTED",
  "CANCELLED",
]);

export function caseRefundBlockReason(input: {
  status: string;
  paymentStatus: string | null;
  postalShipmentStatus: string | null;
}): string | null {
  if (input.paymentStatus === "PENDING") return "PAYMENT_PENDING";
  if (["REJECTED", "CANCELLED"].includes(input.status)) {
    return `CASE_STATUS_${input.status}`;
  }
  if (input.postalShipmentStatus === "SUBMITTING") {
    return "SHIPMENT_STATUS_SUBMITTING";
  }
  return null;
}

export function caseAttachmentBlockReason(input: {
  status: string;
  paymentStatus: string | null;
  generatedPacketCount: number;
}): string | null {
  if (input.generatedPacketCount > 0) return "PACKET_GENERATED";
  if (input.paymentStatus === "PENDING") return "PAYMENT_PENDING";
  if (input.paymentStatus === "PAID") return "PAYMENT_PAID";
  if (input.paymentStatus === "REFUNDED") return "PAYMENT_REFUNDED";
  return attachmentFrozenCaseStatuses.has(input.status)
    ? `CASE_STATUS_${input.status}`
    : null;
}

function readJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readJsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function uniqueTextValues(
  values: Array<Record<string, unknown>>,
  key: string,
): string[] {
  return [
    ...new Set(
      values.flatMap((value) => {
        const candidate = value[key];
        return typeof candidate === "string" && candidate.trim()
          ? [candidate.trim()]
          : [];
      }),
    ),
  ];
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
    return (
      total +
      (typeof quantity === "number" && Number.isFinite(quantity) ? quantity : 0)
    );
  }, 0);
}

function readPostalExpenseClaimSelection(value: unknown): {
  requested: boolean;
  selectedAt: string | null;
} {
  const claim = readJsonObject(readJsonObject(value).postalExpenseClaim);
  return {
    requested: claim.requested === true,
    selectedAt: typeof claim.selectedAt === "string" ? claim.selectedAt : null,
  };
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? {}
    : (JSON.parse(serialized) as Prisma.InputJsonValue);
}

function missingRequiredDocumentLabels(
  value: unknown,
  attachedKinds: Set<string>,
): string[] {
  return findMissingDocumentRequirements(value, attachedKinds).map((document) =>
    documentRequirementShortName(document.kind),
  );
}

function isUsableCaseDocument(document: {
  kind: DocumentKind;
  watermarked: boolean;
}): boolean {
  if (
    document.kind !== DocumentKind.IDENTITY_DOCUMENT &&
    document.kind !== DocumentKind.BANK_DETAILS
  ) {
    return true;
  }

  return document.watermarked;
}
