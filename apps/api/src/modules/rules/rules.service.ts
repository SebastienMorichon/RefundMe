import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RuleStatus } from "@prisma/client";
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

@Injectable()
export class RulesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rules = await this.prisma.gameRule.findMany({
      include: {
        organizer: true,
        sourceDocument: { select: { id: true, originalName: true, uploadedAt: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    return rules.map((rule) => this.present(rule));
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
    const rule = await this.prisma.gameRule.findUnique({
      where: { id: ruleId },
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
