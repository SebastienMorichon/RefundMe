import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../identity/admin.guard";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { PricingService } from "./pricing.service";

@Controller("admin/pricing")
@UseGuards(AuthGuard, AdminGuard)
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  async get() {
    return { pricing: await this.pricing.get() };
  }

  @Patch()
  async update(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return { pricing: await this.pricing.update(body, request.user!.id) };
  }
}
