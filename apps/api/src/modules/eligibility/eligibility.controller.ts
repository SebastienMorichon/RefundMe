import { Controller, Get, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { EligibilityService } from "./eligibility.service";

@Controller()
@UseGuards(AuthGuard)
export class EligibilityController {
  constructor(private readonly eligibility: EligibilityService) {}

  @Post("documents/:id/analyze")
  async analyze(@Param("id") documentId: string, @Req() request: AuthenticatedRequest) {
    return this.eligibility.analyzeInvoice(documentId, this.requireUserId(request));
  }

  @Get("cases")
  async listCases(@Req() request: AuthenticatedRequest) {
    return { cases: await this.eligibility.listCases(this.requireUserId(request)) };
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException("Session requise.");
    }

    return request.user.id;
  }
}
