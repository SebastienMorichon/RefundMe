import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DocumentKind, Prisma, RuleStatus } from "@prisma/client";
import {
  MistralAiProvider,
  MistralOcrProvider,
  EncryptedSensitiveTextProvider,
  LocalEncryptedObjectStorageProvider,
} from "@lydoc/infrastructure";
import { requireDocumentEligibleForAi } from "../../platform/ai-document-policy";
import { PrismaService } from "../prisma/prisma.service";
import { readPostalExpenseReimbursement } from "./postal-expense-reimbursement";
import {
  lockDocumentLifecycle,
  lockGameRule,
} from "../../platform/transaction-locks";
import { createHash } from "node:crypto";

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

export type UpdateGameRuleInput = Omit<
  CreateGameRuleInput,
  "actorId" | "sourceDocumentId"
> &
  Readonly<{
    actorId: string;
    expectedVersion: number;
  }>;

@Injectable()
export class RulesService {
  private readonly mistralOcr = new MistralOcrProvider(
    process.env.MISTRAL_API_KEY ?? "",
  );
  private readonly mistralAi = new MistralAiProvider(
    process.env.MISTRAL_API_KEY ?? "",
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: LocalEncryptedObjectStorageProvider,
    private readonly sensitiveText: EncryptedSensitiveTextProvider = new EncryptedSensitiveTextProvider(),
  ) {}

  async extractCandidate(sourceDocumentId: string, actorId: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: sourceDocumentId,
        kind: DocumentKind.GAME_RULE_PDF,
        ownerId: { not: null },
        deletedAt: null,
      },
      include: { ocrResult: true },
    });

    if (!document || !document.ownerId) {
      throw new BadRequestException(
        "Le PDF source du reglement est introuvable.",
      );
    }

    const existingCandidate = await this.prisma.documentAnalysis.findFirst({
      where: { documentId: document.id, schemaName: "game-rule-candidate-v4" },
      orderBy: { createdAt: "desc" },
    });
    if (existingCandidate) {
      return {
        sourceDocumentId: document.id,
        ...normalizeGameRuleCandidate(existingCandidate.resultJson, undefined),
      };
    }

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
      : await this.runOcr(document, actorId);
    const candidate = await this.analyzeRuleText(
      ocr.text,
      ocr.confidence,
      actorId,
      document.id,
    );

    await this.prisma.$transaction(async (transaction) => {
      await lockDocumentLifecycle(transaction, document.id);
      const activeSource = await transaction.document.findFirst({
        where: {
          id: document.id,
          kind: DocumentKind.GAME_RULE_PDF,
          ownerId: document.ownerId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!activeSource) {
        throw new BadRequestException(
          "Le PDF source du reglement a change pendant l'extraction.",
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
          rawJson: toJsonValue(ocr.raw),
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
          rawJson: toJsonValue(ocr.raw),
        },
      });
      await transaction.documentAnalysis.create({
        data: {
          documentId: document.id,
          provider: ocr.provider,
          schemaName: "game-rule-candidate-v4",
          resultJson: candidate as Prisma.InputJsonValue,
          ...(ocr.confidence === undefined
            ? {}
            : { confidence: ocr.confidence }),
        },
      });
      await transaction.document.update({
        where: { id: document.id },
        data: { status: "OCR_DONE", analyzedAt: new Date() },
      });
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "GAME_RULE_EXTRACTED",
          entityType: "GameRule",
          entityId: document.id,
          metadata: { sourceDocumentId: document.id },
        },
      });
    });

    return { sourceDocumentId: document.id, ...candidate };
  }

  async list() {
    const rules = await this.prisma.gameRule.findMany({
      where: { sourceDocument: { kind: DocumentKind.GAME_RULE_PDF } },
      include: {
        organizer: true,
        sourceDocument: {
          select: { id: true, originalName: true, uploadedAt: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return rules.map((rule) => this.present(rule));
  }

  async catalog() {
    const rules = await this.prisma.gameRule.findMany({
      where: {
        status: RuleStatus.APPROVED,
        sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
      },
      include: { organizer: true },
      orderBy: [{ validFrom: "desc" }, { name: "asc" }],
    });

    const channels = new Map<
      string,
      {
        id: string;
        name: string;
        games: Array<{
          id: string;
          name: string;
          organizer: string;
          validFrom: Date | null;
          validUntil: Date | null;
        }>;
      }
    >();

    for (const rule of rules) {
      const channelName = readChannelName(
        rule.organizer.name,
        rule.constraintsJson,
      );
      const channelId = slugify(channelName);
      const channel = channels.get(channelId) ?? {
        id: channelId,
        name: channelName,
        games: [],
      };
      channel.games.push({
        id: rule.id,
        name: rule.name,
        organizer: rule.organizer.name,
        validFrom: rule.validFrom,
        validUntil: rule.validUntil,
      });
      channels.set(channelId, channel);
    }

    return [...channels.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "fr"),
    );
  }

  async get(ruleId: string) {
    const rule = await this.prisma.gameRule.findFirst({
      where: {
        id: ruleId,
        sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
      },
      include: {
        organizer: true,
        sourceDocument: {
          select: { id: true, originalName: true, uploadedAt: true },
        },
      },
    });

    if (!rule) {
      throw new NotFoundException("Reglement introuvable.");
    }

    return this.present(rule);
  }

  async update(ruleId: string, input: UpdateGameRuleInput) {
    this.assertInput({ ...input, sourceDocumentId: "existing" });
    assertExpectedRuleVersion(input.expectedVersion);
    const organizerName = input.organizerName.trim();
    const organizerSlug = toSlug(organizerName);
    const updatedRule = await this.prisma.$transaction(async (transaction) => {
      await lockGameRule(transaction, ruleId);
      const existingRule = await transaction.gameRule.findFirst({
        where: {
          id: ruleId,
          sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
        },
        select: { id: true, status: true, version: true },
      });
      if (!existingRule) {
        throw new NotFoundException("Reglement introuvable.");
      }
      assertRuleVersionMatches(existingRule.version, input.expectedVersion);

      const organizer = await transaction.organizer.upsert({
        where: { slug: organizerSlug },
        create: { name: organizerName, slug: organizerSlug },
        update: {},
        select: { id: true },
      });
      const changed = await transaction.gameRule.updateMany({
        where: {
          id: existingRule.id,
          version: input.expectedVersion,
          status: existingRule.status,
        },
        data: {
          organizerId: organizer.id,
          name: input.name.trim(),
          reimbursementCents: input.reimbursementCents,
          requiredDocuments: input.requiredDocuments as Prisma.InputJsonValue,
          constraintsJson: input.constraints as Prisma.InputJsonValue,
          validFrom: input.validFrom ?? null,
          validUntil: input.validUntil ?? null,
          status: RuleStatus.NEEDS_REVIEW,
          version: { increment: 1 },
          reviewedAt: null,
          reviewedById: null,
        },
      });
      if (changed.count !== 1) throw ruleVersionConflict();

      const updated = await findPresentableRule(transaction, existingRule.id);
      if (!updated) {
        throw new NotFoundException("Reglement introuvable.");
      }
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "GAME_RULE_UPDATED",
          entityType: "GameRule",
          entityId: updated.id,
          metadata: {
            previousVersion: existingRule.version,
            version: updated.version,
            previousStatus: existingRule.status,
            status: updated.status,
          },
        },
      });
      return updated;
    });
    return this.present(updatedRule);
  }

  async create(input: CreateGameRuleInput) {
    this.assertInput(input);
    const organizerName = input.organizerName.trim();
    const organizerSlug = toSlug(organizerName);
    const rule = await this.prisma.$transaction(async (transaction) => {
      await lockDocumentLifecycle(transaction, input.sourceDocumentId);
      const sourceDocument = await transaction.document.findFirst({
        where: {
          id: input.sourceDocumentId,
          kind: DocumentKind.GAME_RULE_PDF,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!sourceDocument) {
        throw new BadRequestException(
          "Le PDF source du reglement est introuvable.",
        );
      }
      const organizer = await transaction.organizer.upsert({
        where: { slug: organizerSlug },
        create: { name: organizerName, slug: organizerSlug },
        update: {},
        select: { id: true },
      });
      const created = await transaction.gameRule.create({
        data: {
          organizerId: organizer.id,
          sourceDocumentId: sourceDocument.id,
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
          sourceDocument: {
            select: { id: true, originalName: true, uploadedAt: true },
          },
        },
      });
      await transaction.auditLog.create({
        data: {
          actorId: input.actorId,
          action: "GAME_RULE_CREATED",
          entityType: "GameRule",
          entityId: created.id,
          metadata: {
            sourceDocumentId: sourceDocument.id,
            version: created.version,
          },
        },
      });
      return created;
    });

    return this.present(rule);
  }

  async approve(ruleId: string, actorId: string, expectedVersion: number) {
    assertExpectedRuleVersion(expectedVersion);
    const approvedRule = await this.prisma.$transaction(async (transaction) => {
      await lockGameRule(transaction, ruleId);
      const rule = await findPresentableRule(transaction, ruleId);
      if (!rule) {
        throw new NotFoundException("Reglement introuvable.");
      }
      assertRuleVersionMatches(rule.version, expectedVersion);
      if (rule.status !== RuleStatus.NEEDS_REVIEW) {
        throw new BadRequestException(
          "Seul un reglement en relecture peut etre approuve.",
        );
      }

      const reviewedAt = new Date();
      const changed = await transaction.gameRule.updateMany({
        where: {
          id: rule.id,
          version: expectedVersion,
          status: RuleStatus.NEEDS_REVIEW,
        },
        data: {
          status: RuleStatus.APPROVED,
          reviewedById: actorId,
          reviewedAt,
        },
      });
      if (changed.count !== 1) throw ruleVersionConflict();

      const approved = await findPresentableRule(transaction, rule.id);
      if (!approved) {
        throw new NotFoundException("Reglement introuvable.");
      }
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "GAME_RULE_APPROVED",
          entityType: "GameRule",
          entityId: approved.id,
          metadata: {
            version: approved.version,
            reviewedAt: reviewedAt.toISOString(),
            contentSha256: gameRuleContentFingerprint(approved),
          },
        },
      });
      return approved;
    });
    return this.present(approvedRule);
  }

  async delete(
    ruleId: string,
    actorId: string,
    expectedVersion: number,
  ): Promise<void> {
    assertExpectedRuleVersion(expectedVersion);
    await this.prisma.$transaction(async (transaction) => {
      await lockGameRule(transaction, ruleId);
      const rule = await transaction.gameRule.findFirst({
        where: {
          id: ruleId,
          sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
        },
        select: {
          id: true,
          name: true,
          version: true,
          organizer: { select: { name: true } },
          _count: { select: { cases: true } },
        },
      });
      if (!rule) {
        throw new NotFoundException("Reglement introuvable.");
      }
      assertRuleVersionMatches(rule.version, expectedVersion);
      if (rule._count.cases > 0) {
        throw new BadRequestException(
          "Ce reglement est deja utilise par un dossier client et ne peut pas etre supprime.",
        );
      }
      const deleted = await transaction.gameRule.deleteMany({
        where: {
          id: rule.id,
          version: expectedVersion,
          cases: { none: {} },
        },
      });
      if (deleted.count !== 1) throw ruleVersionConflict();
      await transaction.auditLog.create({
        data: {
          actorId,
          action: "GAME_RULE_DELETED",
          entityType: "GameRule",
          entityId: rule.id,
          metadata: {
            name: rule.name,
            organizerName: rule.organizer.name,
            version: rule.version,
          },
        },
      });
    });
  }

  private assertInput(input: CreateGameRuleInput): void {
    if (!input.organizerName.trim() || !input.name.trim()) {
      throw new BadRequestException(
        "Organisateur et nom du reglement sont requis.",
      );
    }

    if (
      !Number.isInteger(input.reimbursementCents) ||
      input.reimbursementCents < 0
    ) {
      throw new BadRequestException(
        "Le montant doit etre exprime en centimes entiers.",
      );
    }

    if (
      input.validFrom &&
      input.validUntil &&
      input.validFrom > input.validUntil
    ) {
      throw new BadRequestException(
        "La date de fin doit etre posterieure a la date de debut.",
      );
    }

    if (
      input.requiredDocuments.some(
        (document) => !document.kind || !document.label,
      )
    ) {
      throw new BadRequestException(
        "Chaque piece requise doit avoir un type et un libelle.",
      );
    }
  }

  private async runOcr(
    document: {
      id: string;
      ownerId: string | null;
      kind: DocumentKind;
      mimeType: string;
      storageBucket: string;
      storageKey: string;
      checksumSha256: string;
      sizeBytes: number;
    },
    actorId: string,
  ) {
    if (!document.ownerId) {
      throw new BadRequestException(
        "Le proprietaire du document est introuvable.",
      );
    }

    requireDocumentEligibleForAi(document.kind);
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

    await this.reserveMistralCall(actorId, "RULE_OCR", document.id);
    return this.mistralOcr.extractText({ bytes, mimeType: document.mimeType });
  }

  private async analyzeRuleText(
    text: string,
    ocrConfidence: number | undefined,
    actorId: string,
    documentId: string,
  ) {
    await this.reserveMistralCall(actorId, "RULE_EXTRACTION", documentId);
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
    "channelName": "chaine de television ou marque diffuseur clairement citee, ou chaine vide",
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
    "postalExpenseReimbursement": {
      "available": false,
      "appliesTo": "REFUND_REQUEST|RULE_COPY_REQUEST|BOTH|UNSPECIFIED",
      "postage": {
        "reimbursable": false,
        "amountCents": null,
        "basis": "montant exact ou formulation du tarif postal, ou chaine vide"
      },
      "printing": {
        "reimbursable": false,
        "centsPerPage": null,
        "maxPages": null,
        "basis": "formulation exacte du bareme de photocopie ou impression, ou chaine vide"
      },
      "claimLimit": {
        "scope": "PER_REQUEST|PER_PARTICIPANT_PER_MONTH|PER_PARTICIPANT_PER_GAME|PER_HOUSEHOLD_PER_GAME|OTHER|UNSPECIFIED",
        "strict": false,
        "details": "limite fidelement reprise, ou chaine vide"
      },
      "requestInstructions": "modalite exacte pour demander ces frais, ou chaine vide",
      "requiredProofs": ["justificatifs specifiques demandes"],
      "sourceReference": "article ou section, ou chaine vide"
    },
    "keywords": ["mots utiles a la detection"],
    "sourceReferences": ["article ou section du reglement si explicite"]
  },
  "confidence": 0.0
}
Lis l'integralite du texte OCR, y compris les annexes. Recherche en priorite les articles contenant les termes remboursement, frais de participation, SMS, justificatif, RIB, facture, demande, adresse et delai.
Le champ reimbursementCents est le montant remboursable par participation, exprime sous forme de nombre entier de centimes. Le champ confidence est un nombre entre 0 et 1.
Pour postalExpenseReimbursement, distingue imperativement les frais lies a la demande de remboursement des frais lies a une simple demande de copie du reglement. available ne vaut true que si le texte autorise explicitement le remboursement de l'affranchissement ou des impressions/photocopies. Utilise null lorsqu'un montant n'est pas chiffre et recopie alors le bareme dans basis. Ne transforme pas une recommandation en limite stricte.
N'invente aucune information. Ne deduis jamais une adresse, une date ou une piece demandee. Les conditions de remboursement et d'eligibilite doivent etre distinctes, precises et fidelement reprises du texte. Tous les champs doivent etre presents dans le JSON, meme lorsqu'ils sont vides.`,
    });

    return normalizeGameRuleCandidate(result.data, ocrConfidence);
  }

  private async reserveMistralCall(
    actorId: string,
    purpose: "RULE_OCR" | "RULE_EXTRACTION",
    documentId: string,
  ): Promise<void> {
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1_000);
    const day = startOfDay.toISOString().slice(0, 10);
    const accountLimit = readQuotaLimit(
      process.env.AI_DAILY_ACCOUNT_CALL_LIMIT,
      10,
      1_000,
    );
    const providerLimit = readQuotaLimit(
      process.env.MISTRAL_DAILY_CALL_LIMIT,
      1_000,
      100_000,
    );
    await this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`mistral-quota:global:${day}`}))
        `;
        await transaction.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`mistral-quota:account:${day}:${actorId}`}))
        `;
        const providerCount = await transaction.auditLog.count({
          where: {
            action: "MISTRAL_CALL_RESERVED",
            createdAt: { gte: startOfDay, lt: endOfDay },
          },
        });
        const accountCount = await transaction.auditLog.count({
          where: {
            actorId,
            action: "MISTRAL_CALL_RESERVED",
            createdAt: { gte: startOfDay, lt: endOfDay },
          },
        });
        if (providerCount >= providerLimit || accountCount >= accountLimit) {
          throw new HttpException(
            "Le quota quotidien d'analyse est atteint. Reessayez demain.",
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
        await transaction.auditLog.create({
          data: {
            actorId,
            action: "MISTRAL_CALL_RESERVED",
            entityType: "Document",
            entityId: documentId,
            metadata: {
              provider: "mistral",
              purpose,
              day,
              accountUsage: accountCount + 1,
              accountLimit,
              providerUsage: providerCount + 1,
              providerLimit,
            },
          },
        });
      },
      { maxWait: 5_000, timeout: 10_000 },
    );
  }

  private present(rule: {
    id: string;
    status: RuleStatus;
    version: number;
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
      version: rule.version,
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

async function findPresentableRule(
  transaction: Prisma.TransactionClient,
  ruleId: string,
) {
  return transaction.gameRule.findFirst({
    where: {
      id: ruleId,
      sourceDocument: { kind: DocumentKind.GAME_RULE_PDF },
    },
    include: {
      organizer: true,
      sourceDocument: {
        select: { id: true, originalName: true, uploadedAt: true },
      },
    },
  });
}

function assertExpectedRuleVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException("La version du reglement relu est requise.");
  }
}

function assertRuleVersionMatches(actual: number, expected: number): void {
  if (actual !== expected) throw ruleVersionConflict();
}

function ruleVersionConflict(): ConflictException {
  return new ConflictException(
    "Le reglement a change depuis son chargement. Rechargez-le et relisez la nouvelle version avant toute validation.",
  );
}

export function gameRuleContentFingerprint(rule: {
  organizerId: string;
  sourceDocumentId: string;
  name: string;
  version: number;
  reimbursementCents: number;
  requiredDocuments: Prisma.JsonValue;
  constraintsJson: Prisma.JsonValue;
  validFrom: Date | null;
  validUntil: Date | null;
}): string {
  return createHash("sha256")
    .update(
      stableJson({
        organizerId: rule.organizerId,
        sourceDocumentId: rule.sourceDocumentId,
        name: rule.name,
        version: rule.version,
        reimbursementCents: rule.reimbursementCents,
        requiredDocuments: rule.requiredDocuments,
        constraintsJson: rule.constraintsJson,
        validFrom: rule.validFrom?.toISOString() ?? null,
        validUntil: rule.validUntil?.toISOString() ?? null,
      }),
      "utf8",
    )
    .digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function ocrTextContext(documentId: string): string {
  return `ocr-result:${documentId}`;
}

function normalizeGameRuleCandidate(
  value: unknown,
  ocrConfidence: number | undefined,
) {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const constraints =
    input.constraints &&
    typeof input.constraints === "object" &&
    !Array.isArray(input.constraints)
      ? (input.constraints as Record<string, unknown>)
      : {};
  const rawConditions = Array.isArray(input.conditions)
    ? input.conditions
    : Array.isArray(constraints.conditions)
      ? constraints.conditions
      : [];
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
        return typeof value.kind === "string" &&
          typeof value.label === "string" &&
          typeof value.required === "boolean"
          ? [{ kind: value.kind, label: value.label, required: value.required }]
          : [];
      })
    : [];
  const parsedConfidence = readFiniteNumber(input.confidence);
  const aiConfidence =
    parsedConfidence !== undefined &&
    parsedConfidence >= 0 &&
    parsedConfidence <= 1
      ? parsedConfidence
      : 0.4;
  const parsedReimbursementCents = readFiniteNumber(input.reimbursementCents);
  const postalExpenseReimbursement = readPostalExpenseReimbursement(
    constraints.postalExpenseReimbursement,
  );

  return {
    organizerName:
      typeof input.organizerName === "string" ? input.organizerName : "",
    name: typeof input.name === "string" ? input.name : "",
    reimbursementCents:
      parsedReimbursementCents !== undefined &&
      Number.isInteger(parsedReimbursementCents) &&
      parsedReimbursementCents >= 0
        ? parsedReimbursementCents
        : 0,
    requiredDocuments,
    constraints: {
      ...constraints,
      conditions,
      postalExpenseReimbursement,
      ...(typeof input.gameDate === "string"
        ? { gameDate: input.gameDate }
        : {}),
    },
    ...(typeof input.validFrom === "string"
      ? { validFrom: input.validFrom }
      : {}),
    ...(typeof input.validUntil === "string"
      ? { validUntil: input.validUntil }
      : {}),
    confidence:
      ocrConfidence === undefined
        ? aiConfidence
        : Math.min(aiConfidence, ocrConfidence),
  };
}

function readFiniteNumber(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? {}
    : (JSON.parse(serialized) as Prisma.InputJsonValue);
}

function readChannelName(
  organizerName: string,
  constraints: Prisma.JsonValue,
): string {
  const input =
    constraints &&
    typeof constraints === "object" &&
    !Array.isArray(constraints)
      ? (constraints as Record<string, unknown>)
      : {};
  const explicitChannel = [
    input.channelName,
    input.channel,
    input.broadcaster,
    input.tvChannel,
    input.chaine,
  ]
    .find(
      (value): value is string =>
        typeof value === "string" && value.trim().length > 0,
    )
    ?.trim();
  const normalized = `${explicitChannel ?? ""} ${organizerName}`
    .toLocaleLowerCase("fr-FR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, " ");

  if (/\b6ter\b/.test(normalized)) return "6ter";
  if (/\bw9\b/.test(normalized)) return "W9";
  if (/\bm6\b|metropole television/.test(normalized)) return "M6";
  if (/\btf1\b/.test(normalized)) return "TF1";
  if (/france\s*(?:televisions?|tv)|\bfrance\s*[2345]\b/.test(normalized))
    return "France Télévisions";
  if (/\bc8\b/.test(normalized)) return "C8";

  return explicitChannel || organizerName;
}

function slugify(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "autre"
  );
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

function readQuotaLimit(
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}
