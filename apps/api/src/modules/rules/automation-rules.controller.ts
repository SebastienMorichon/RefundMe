import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  type ImportGameRuleInput,
  type RequiredDocumentInput,
  RulesService,
} from "./rules.service";

type AutomationRuleBody = Readonly<{
  sourceUrl?: string;
  organizerName?: string;
  name?: string;
  reimbursementCents?: number;
  requiredDocuments?: RequiredDocumentInput[];
  constraints?: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
}>;

@Controller("automation/rules")
export class AutomationRulesController {
  constructor(private readonly rules: RulesService) {}

  @Post()
  @HttpCode(200)
  async importRule(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: AutomationRuleBody,
  ) {
    assertAutomationToken(authorization);
    const input: ImportGameRuleInput = {
      sourceUrl: body.sourceUrl ?? "",
      organizerName: body.organizerName ?? "",
      name: body.name ?? "",
      reimbursementCents: body.reimbursementCents ?? -1,
      requiredDocuments: Array.isArray(body.requiredDocuments)
        ? body.requiredDocuments
        : [],
      constraints:
        body.constraints &&
        typeof body.constraints === "object" &&
        !Array.isArray(body.constraints)
          ? body.constraints
          : {},
      ...(body.validFrom ? { validFrom: parseDate(body.validFrom) } : {}),
      ...(body.validUntil ? { validUntil: parseDate(body.validUntil) } : {}),
    };
    return this.rules.importFromAutomation(input);
  }
}

function assertAutomationToken(authorization: string | undefined): void {
  const expected = process.env.RULE_AUTOMATION_TOKEN?.trim() ?? "";
  if (expected.length < 32 || /change[_-]?me|replace-with/i.test(expected)) {
    throw new ServiceUnavailableException(
      "L'import automatise des reglements n'est pas configure.",
    );
  }
  const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
  const received = match?.[1] ?? "";
  const expectedHash = createHash("sha256").update(expected).digest();
  const receivedHash = createHash("sha256").update(received).digest();
  if (!received || !timingSafeEqual(expectedHash, receivedHash)) {
    throw new UnauthorizedException("Jeton d'automatisation invalide.");
  }
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new BadRequestException("Date invalide.");
  }
  return date;
}
