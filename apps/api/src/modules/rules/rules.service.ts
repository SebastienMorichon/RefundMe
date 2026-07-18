import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DocumentKind, Prisma, RuleStatus } from "@prisma/client";
import { MistralAiProvider, MistralOcrProvider, LocalEncryptedObjectStorageProvider } from "@lydoc/infrastructure";
import { PrismaService } from "../prisma/prisma.service";

export type RequiredDocumentInput = Readonly<{
  kind: string;
  label: string;
  required: boolean;
}>;

export type CreateGameRuleInput = Readonly<{
  actorId: string;
  sourceDocumentId: string;
  organizerName: string;
  name: string;
  reimbursementCents: number;
  requiredDocuments: RequiredDocumentInput[];
  constraints: Record<string, unknown>;
  validFrom?: Date;
  validUntil?: Date;
}>;

export type UpdateGameRuleInput = Omit<CreateGameRuleInput, "actorId" | "sourceDocumentId"> & Readonly<{
  actorId: string;
}>;

@Injectable()
export class RulesService {
  private readonly mistralOcr = new MistralOcrProvider(process.env.MISTRAL_API_KEY ?? "");
  private readonly mistralAi = new MistralAiProvider(process.env.MISTRAL_API_KEY ?? "");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
  ) {}

  async extractCandidate(sourceDocumentId: string, actorId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: sourceDocumentId },
      include: { ocrResult: true },
    });

    if (!document || document.kind !== "GAME_RULE_PDF" || !document.ownerId) {
      throw new BadRequestException("Le PDF source du reglement est introuvable.");
    }

    const existingCandidate = await this.prisma.documentAnalysis.findFirst({
      where: { documentId: document.id, schemaName: "game-rule-candidate-v3" },
      orderBy: { createdAt: "desc" },
    });
    if (existingCandidate) {
      return { sourceDocumentId: document.id, ...normalizeGameRuleCandidate(existingCandidate.resultJson, undefined) };
    }

    const ocr = document.ocrResult
      ? {
          text: document.ocrResult.text,
          provider: document.ocrResult.provider,
          ...(document.ocrResult.confidence ? { confidence: Number(document.ocrResult.confidence) } : {}),
          raw: document.ocrResult.rawJson,
        }
      : await this.runOcr(document);
    const candidate = await this.analyzeRuleText(ocr.text, ocr.confidence);

    await this.prisma.$transaction([
      this.prisma.ocrResult.upsert({
        where: { documentId: document.id },
        create: {
          documentId: document.id,
          provider: ocr.provider,
          text: ocr.text,
          ...(ocr.confidence === undefined ? {} : { confidence: ocr.confidence }),
          rawJson: toJsonValue(ocr.raw),
        },
        update: {
          provider: ocr.provider,
          text: ocr.text,
          ...(ocr.confidence === undefined ? {} : { confidence: ocr.confidence }),
          rawJson: toJsonValue(ocr.raw),
        },
      }),
      this.prisma.documentAnalysis.create({
        data: {
          documentId: document.id,
          provider: ocr.provider,
          schemaName: "game-rule-candidate-v3",
          resultJson: candidate as Prisma.InputJsonValue,
          ...(ocr.confidence === undefined ? {} : { confidence: ocr.confidence }),
        },
      }),
      this.prisma.document.update({
        where: { id: document.id },
        data: { status: "OCR_DONE", analyzedAt: new Date() },
      }),
    ]);

    await this.writeAuditLog(actorId, "GAME_RULE_EXTRACTED", document.id, {
      sourceDocumentId: document.id,
    });

    return { sourceDocumentId: document.id, ...candidate };
  }

  async list() {
    const rules = await this.prisma.gameRule.findMany({
      where: { sourceDocument: { kind: DocumentKind.GAME_RULE_PDF } },
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return rules.map((rule) => this.present(rule));
  }

  async get(ruleId: string) {
    const rule = await this.prisma.gameRule.findFirst({
      where: { id: ruleId, sourceDocument: { kind: DocumentKind.GAME_RULE_PDF } },
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
    });

    if (!rule) {
      throw new NotFoundException("Reglement introuvable.");
    }

    return this.present(rule);
  }

  async update(ruleId: string, input: UpdateGameRuleInput) {
    this.assertInput({ ...input, sourceDocumentId: "existing" });
    const existingRule = await this.prisma.gameRule.findFirst({
      where: { id: ruleId, sourceDocument: { kind: DocumentKind.GAME_RULE_PDF } },
    });
    if (!existingRule) {
      throw new NotFoundException("Reglement introuvable.");
    }

    const organizerName = input.organizerName.trim();
    const updatedRule = await this.prisma.gameRule.update({
      where: { id: ruleId },
      data: {
        organizer: {
          connectOrCreate: {
            where: { slug: toSlug(organizerName) },
            create: { name: organizerName, slug: toSlug(organizerName) },
          },
        },
        name: input.name.trim(),
        reimbursementCents: input.reimbursementCents,
        requiredDocuments: input.requiredDocuments as Prisma.InputJsonValue,
        constraintsJson: input.constraints as Prisma.InputJsonValue,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        ...(existingRule.status === RuleStatus.APPROVED
          ? { status: RuleStatus.NEEDS_REVIEW, version: { increment: 1 }, reviewedAt: null, reviewedById: null }
          : {}),
      },
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
    });

    await this.writeAuditLog(input.actorId, "GAME_RULE_UPDATED", updatedRule.id, {
      status: updatedRule.status,
    });
    return this.present(updatedRule);
  }

  async create(input: CreateGameRuleInput) {
    this.assertInput(input);
    const sourceDocument = await this.prisma.document.findUnique({
      where: { id: input.sourceDocumentId },
      select: { id: true, kind: true },
    });

    if (!sourceDocument || sourceDocument.kind !== "GAME_RULE_PDF") {
      throw new BadRequestException("Le PDF source du reglement est introuvable.");
    }

    const organizerName = input.organizerName.trim();
    const organizerSlug = toSlug(organizerName);
    const rule = await this.prisma.gameRule.create({
      data: {
        organizer: {
          connectOrCreate: {
            where: { slug: organizerSlug },
            create: { name: organizerName, slug: organizerSlug },
          },
        },
        sourceDocument: { connect: { id: sourceDocument.id } },
        status: RuleStatus.NEEDS_REVIEW,
        name: input.name.trim(),
        reimbursementCents: input.reimbursementCents,
        requiredDocuments: input.requiredDocuments as Prisma.InputJsonValue,
        constraintsJson: input.constraints as Prisma.InputJsonValue,
        ...(input.validFrom ? { validFrom: input.validFrom } : {}),
        ...(input.validUntil ? { validUntil: input.validUntil } : {}),
      },
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
    });

    await this.writeAuditLog(input.actorId, "GAME_RULE_CREATED", rule.id, {
      sourceDocumentId: sourceDocument.id,
    });

    return this.present(rule);
  }

  async approve(ruleId: string, actorId: string) {
    const rule = await this.prisma.gameRule.findFirst({
      where: { id: ruleId, sourceDocument: { kind: DocumentKind.GAME_RULE_PDF } },
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
    });

    if (!rule) {
      throw new NotFoundException("Reglement introuvable.");
    }

    if (rule.status !== RuleStatus.NEEDS_REVIEW) {
      throw new BadRequestException("Seul un reglement en relecture peut etre approuve.");
    }

    const approvedRule = await this.prisma.gameRule.update({
      where: { id: rule.id },
      data: { status: RuleStatus.APPROVED, reviewedById: actorId, reviewedAt: new Date() },
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
    });

    await this.writeAuditLog(actorId, "GAME_RULE_APPROVED", approvedRule.id, {});
    return this.present(approvedRule);
  }

  async delete(ruleId: string, actorId: string): Promise<void> {
    const rule = await this.prisma.gameRule.findFirst({
      where: { id: ruleId, sourceDocument: { kind: DocumentKind.GAME_RULE_PDF } },
      select: { id: true, name: true, organizer: { select: { name: true } }, _count: { select: { cases: true } } },
    });

    if (!rule) {
      throw new NotFoundException("Reglement introuvable.");
    }

    if (rule._count.cases > 0) {
      throw new BadRequestException("Ce reglement est deja utilise par un dossier client et ne peut pas etre supprime.");
    }

    await this.prisma.$transaction([
      this.prisma.gameRule.delete({ where: { id: rule.id } }),
      this.prisma.auditLog.create({
        data: {
          actorId,
          action: "GAME_RULE_DELETED",
          entityType: "GameRule",
          entityId: rule.id,
          metadata: { name: rule.name, organizerName: rule.organizer.name },
        },
      }),
    ]);
  }

  private assertInput(input: CreateGameRuleInput): void {
    if (!input.organizerName.trim() || !input.name.trim()) {
      throw new BadRequestException("Organisateur et nom du reglement sont requis.");
    }

    if (!Number.isInteger(input.reimbursementCents) || input.reimbursementCents < 0) {
      throw new BadRequestException("Le montant doit etre exprime en centimes entiers.");
    }

    if (input.validFrom && input.validUntil && input.validFrom > input.validUntil) {
      throw new BadRequestException("La date de fin doit etre posterieure a la date de debut.");
    }

    if (input.requiredDocuments.some((document) => !document.kind || !document.label)) {
      throw new BadRequestException("Chaque piece requise doit avoir un type et un libelle.");
    }
  }

  private async writeAuditLog(
    actorId: string,
    action: string,
    entityId: string,
    metadata: Record<string, string>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actorId, action, entityType: "GameRule", entityId, metadata },
    });
  }

  private async runOcr(document: {
    ownerId: string | null;
    kind: string;
    mimeType: string;
    storageBucket: string;
    storageKey: string;
    checksumSha256: string;
    sizeBytes: number;
  }) {
    if (!document.ownerId) {
      throw new BadRequestException("Le proprietaire du document est introuvable.");
    }

    const bytes = await this.storage.getDecryptedObject({
      object: {
        bucket: document.storageBucket,
        key: document.storageKey,
        checksumSha256: document.checksumSha256,
        sizeBytes: document.sizeBytes,
      },
      encryptionContext: { ownerId: document.ownerId, documentKind: document.kind },
    });

    return this.mistralOcr.extractText({ bytes, mimeType: document.mimeType });
  }

  private async analyzeRuleText(text: string, ocrConfidence: number | undefined) {
    const result = await this.mistralAi.extractStructuredData<unknown>({
      locale: "fr-FR",
      documentText: text,
      instruction: `Tu analyses un reglement de jeu francais afin de preparer, plus tard, une demande de remboursement de frais SMS ou de participation.
Retourne uniquement un objet JSON avec ces champs:
{
  "name": "nom du jeu ou de l'operation, ou chaine vide",
  "organizerName": "organisateur, ou chaine vide",
  "gameDate": "date ISO YYYY-MM-DD ou null",
  "validFrom": "date ISO YYYY-MM-DD ou null",
  "validUntil": "date ISO YYYY-MM-DD ou null",
  "reimbursementCents": 0,
  "conditions": [{"title": "condition courte", "details": "formulation fidele au reglement"}],
  "requiredDocuments": [{"kind": "ORANGE_INVOICE|IDENTITY_DOCUMENT|BANK_DETAILS|PURCHASE_PROOF|OTHER", "label": "piece demandee", "required": true}],
  "constraints": {
    "participationMechanism": "SMS+, site web, appel ou autre, ou chaine vide",
    "participationPeriod": "periode de participation fidele au reglement, ou chaine vide",
    "eligibilityConditions": ["conditions d'eligibilite fidelement reprises"],
    "reimbursementConditions": ["conditions precises du remboursement, plafonds inclus"],
    "excludedCosts": ["frais exclus ou chaine vide"],
    "reimbursementDeadline": "date ISO YYYY-MM-DD si calculable, sinon formulation fidele ou chaine vide",
    "reimbursementRecipient": "service ou destinataire de la demande, ou chaine vide",
    "reimbursementAddress": "adresse postale complete, ou chaine vide",
    "reimbursementEmail": "adresse e-mail de reclamation, ou chaine vide",
    "reimbursementMethod": "virement, cheque ou autre, ou chaine vide",
    "requiredLetterMentions": ["mentions ou justificatifs a joindre a la lettre"],
    "keywords": ["mots utiles a la detection"],
    "sourceReferences": ["article ou section du reglement si explicite"]
  },
  "confidence": 0.0
}
Lis l'integralite du texte OCR, y compris les annexes. Recherche en priorite les articles contenant les termes remboursement, frais de participation, SMS, justificatif, RIB, facture, demande, adresse et delai.
Le champ reimbursementCents est le montant remboursable par participation, exprime sous forme de nombre entier de centimes. Le champ confidence est un nombre entre 0 et 1.
N'invente aucune information. Ne deduis jamais une adresse, une date ou une piece demandee. Les conditions de remboursement et d'eligibilite doivent etre distinctes, precises et fidelement reprises du texte. Tous les champs doivent etre presents dans le JSON, meme lorsqu'ils sont vides.`,
    });

    return normalizeGameRuleCandidate(result.data, ocrConfidence);
  }

  private present(rule: {
    id: string;
    status: RuleStatus;
    name: string;
    reimbursementCents: number;
    requiredDocuments: Prisma.JsonValue;
    constraintsJson: Prisma.JsonValue;
    validFrom: Date | null;
    validUntil: Date | null;
    reviewedAt: Date | null;
    organizer: { id: string; name: string };
    sourceDocument: { id: string; originalName: string; uploadedAt: Date };
  }) {
    return {
      id: rule.id,
      status: rule.status,
      name: rule.name,
      organizer: rule.organizer,
      reimbursementCents: rule.reimbursementCents,
      requiredDocuments: rule.requiredDocuments,
      constraints: rule.constraintsJson,
      validFrom: rule.validFrom,
      validUntil: rule.validUntil,
      reviewedAt: rule.reviewedAt,
      sourceDocument: rule.sourceDocument,
    };
  }
}

function normalizeGameRuleCandidate(value: unknown, ocrConfidence: number | undefined) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const constraints = input.constraints && typeof input.constraints === "object" && !Array.isArray(input.constraints)
    ? input.constraints as Record<string, unknown>
    : {};
  const rawConditions = Array.isArray(input.conditions)
    ? input.conditions
    : Array.isArray(constraints.conditions) ? constraints.conditions : [];
  const conditions = rawConditions.flatMap((condition) => {
        if (!condition || typeof condition !== "object") return [];
        const value = condition as Record<string, unknown>;
        return typeof value.title === "string" && typeof value.details === "string"
          ? [{ title: value.title, details: value.details }]
          : [];
      });
  const requiredDocuments = Array.isArray(input.requiredDocuments)
    ? input.requiredDocuments.flatMap((document) => {
        if (!document || typeof document !== "object") return [];
        const value = document as Record<string, unknown>;
        return typeof value.kind === "string" && typeof value.label === "string" && typeof value.required === "boolean"
          ? [{ kind: value.kind, label: value.label, required: value.required }]
          : [];
      })
    : [];
  const parsedConfidence = readFiniteNumber(input.confidence);
  const aiConfidence = parsedConfidence !== undefined && parsedConfidence >= 0 && parsedConfidence <= 1
    ? parsedConfidence
    : 0.4;
  const parsedReimbursementCents = readFiniteNumber(input.reimbursementCents);

  return {
    organizerName: typeof input.organizerName === "string" ? input.organizerName : "",
    name: typeof input.name === "string" ? input.name : "",
    reimbursementCents: parsedReimbursementCents !== undefined && Number.isInteger(parsedReimbursementCents) && parsedReimbursementCents >= 0
      ? parsedReimbursementCents
      : 0,
    requiredDocuments,
    constraints: {
      ...constraints,
      conditions,
      ...(typeof input.gameDate === "string" ? { gameDate: input.gameDate } : {}),
    },
    ...(typeof input.validFrom === "string" ? { validFrom: input.validFrom } : {}),
    ...(typeof input.validUntil === "string" ? { validUntil: input.validUntil } : {}),
    confidence: ocrConfidence === undefined ? aiConfidence : Math.min(aiConfidence, ocrConfidence),
  };
}

function readFiniteNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? {} : JSON.parse(serialized) as Prisma.InputJsonValue;
}

function toSlug(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new BadRequestException("Le nom de l'organisateur est invalide.");
  }

  return slug;
}
