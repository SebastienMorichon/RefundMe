import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
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
    const [pricing, promoCodes] = await Promise.all([
      this.pricing.get(),
      this.pricing.listPromoCodes(),
    ]);
    return { pricing, promoCodes };
  }

  @Patch()
  async update(@Body() body: Record<string, unknown>, @Req() request: AuthenticatedRequest) {
    return { pricing: await this.pricing.update(body, request.user!.id) };
  }

  @Post("promo-codes")
  async createPromoCode(
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      promoCode: await this.pricing.createPromoCode(body, request.user!.id),
    };
  }

  @Patch("promo-codes/:id")
  async updatePromoCode(
    @Param("id") id: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      promoCode: await this.pricing.updatePromoCode(id, body, request.user!.id),
    };
  }
}

@Controller("payments/configuration")
@UseGuards(AuthGuard)
export class PaymentConfigurationController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  async get() {
    return { configuration: await this.pricing.getPublicStatus() };
  }
}
