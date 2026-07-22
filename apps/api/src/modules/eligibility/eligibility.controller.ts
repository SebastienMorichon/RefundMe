import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
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

  @Get("cases/:id")
  async getCase(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { case: await this.eligibility.getCase(caseId, this.requireUserId(request)) };
  }

  @Delete("cases/:id")
  async deleteCase(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { deleted: await this.eligibility.deleteCase(caseId, this.requireUserId(request)) };
  }

  @Post("cases/:id/start")
  async startCase(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { case: await this.eligibility.startCase(caseId, this.requireUserId(request)) };
  }

  @Post("cases/:id/confirm")
  async confirmCase(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { case: await this.eligibility.confirmCase(caseId, this.requireUserId(request)) };
  }

  @Post("cases/:id/fulfillment")
  async chooseFulfillment(
    @Param("id") caseId: string,
    @Body() body: { mode?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      case: await this.eligibility.chooseFulfillment(caseId, body.mode ?? "", this.requireUserId(request)),
    };
  }

  @Post("cases/:id/documents")
  async attachDocument(
    @Param("id") caseId: string,
    @Body() body: { documentId?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      case: await this.eligibility.attachDocument(caseId, body.documentId ?? "", this.requireUserId(request)),
    };
  }

  private requireUserId(request: AuthenticatedRequest): string {
    if (!request.user) {
      throw new UnauthorizedException("Session requise.");
    }

    return request.user.id;
  }
}
