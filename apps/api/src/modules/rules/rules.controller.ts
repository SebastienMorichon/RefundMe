import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
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
}>;

@Controller("admin/rules")
@UseGuards(AuthGuard, AdminGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get()
  async list() {
    return { rules: await this.rules.list() };
  }

  @Post()
  async create(@Body() body: CreateRuleBody, @Req() request: AuthenticatedRequest) {
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

  @Patch(":id/approve")
  async approve(@Param("id") ruleId: string, @Req() request: AuthenticatedRequest) {
    return { rule: await this.rules.approve(ruleId, request.user!.id) };
  }
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new Error("Date invalide.");
  }

  return date;
}
