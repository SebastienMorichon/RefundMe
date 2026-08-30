import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "../identity/admin.guard";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { type RequiredDocumentInput, RulesService } from "./rules.service";

type CreateRuleBody = Readonly<{
  sourceDocumentId?: string;
  organizerName?: string;
  name?: string;
  reimbursementCents?: number;
  requiredDocuments?: RequiredDocumentInput[];
  constraints?: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
  expectedVersion?: number;
}>;

type VersionedMutationBody = Readonly<{ expectedVersion?: number }>;

@Controller("admin/rules")
@UseGuards(AuthGuard, AdminGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  async list() {
    return { rules: await this.rules.list() };
  }

  @Post("extract/:documentId")
  async extract(
    @Param("documentId") documentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      candidate: await this.rules.extractCandidate(
        documentId,
        request.user!.id,
      ),
    };
  }

  @Get(":id")
  async get(@Param("id") ruleId: string) {
    return { rule: await this.rules.get(ruleId) };
  }

  @Post()
  async create(
    @Body() body: CreateRuleBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      rule: await this.rules.create({
        actorId: request.user!.id,
        sourceDocumentId: body.sourceDocumentId ?? "",
        organizerName: body.organizerName ?? "",
        name: body.name ?? "",
        reimbursementCents: body.reimbursementCents ?? -1,
        requiredDocuments: body.requiredDocuments ?? [],
        constraints: body.constraints ?? {},
        ...(body.validFrom ? { validFrom: parseDate(body.validFrom) } : {}),
        ...(body.validUntil ? { validUntil: parseDate(body.validUntil) } : {}),
      }),
    };
  }

  @Patch(":id")
  async update(
    @Param("id") ruleId: string,
    @Body() body: CreateRuleBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      rule: await this.rules.update(ruleId, {
        actorId: request.user!.id,
        expectedVersion: parseExpectedVersion(body.expectedVersion),
        organizerName: body.organizerName ?? "",
        name: body.name ?? "",
        reimbursementCents: body.reimbursementCents ?? -1,
        requiredDocuments: body.requiredDocuments ?? [],
        constraints: body.constraints ?? {},
        ...(body.validFrom ? { validFrom: parseDate(body.validFrom) } : {}),
        ...(body.validUntil ? { validUntil: parseDate(body.validUntil) } : {}),
      }),
    };
  }

  @Patch(":id/approve")
  async approve(
    @Param("id") ruleId: string,
    @Body() body: VersionedMutationBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      rule: await this.rules.approve(
        ruleId,
        request.user!.id,
        parseExpectedVersion(body.expectedVersion),
      ),
    };
  }

  @Delete(":id")
  async delete(
    @Param("id") ruleId: string,
    @Body() body: VersionedMutationBody,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.rules.delete(
      ruleId,
      request.user!.id,
      parseExpectedVersion(body.expectedVersion),
    );
    return { deleted: true };
  }
}

function parseExpectedVersion(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new BadRequestException("La version du reglement relu est requise.");
  }
  return value as number;
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("Date invalide.");
  }

  return date;
}
