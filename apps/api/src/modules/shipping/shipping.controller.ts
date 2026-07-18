import { Controller, Get, Param, Post, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { ShippingService } from "./shipping.service";

@Controller("cases")
@UseGuards(AuthGuard)
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post(":id/postal-quote")
  async quote(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { shipment: await this.shipping.quote(caseId, this.userId(request)) };
  }

  @Get(":id/postal-shipment")
  async get(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { shipment: await this.shipping.get(caseId, this.userId(request)) };
  }

  @Post(":id/postal-shipment/refresh")
  async refresh(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { shipment: await this.shipping.refresh(caseId, this.userId(request)) };
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) throw new UnauthorizedException("Session requise.");
    return request.user.id;
  }
}
