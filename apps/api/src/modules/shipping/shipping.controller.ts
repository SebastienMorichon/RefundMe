import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { ShippingService } from "./shipping.service";

@Controller("cases")
@UseGuards(AuthGuard)
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post(":id/postal-quote")
  async quote(
    @Param("id") caseId: string,
    @Body() body: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      shipment: await this.shipping.quote(
        caseId,
        this.userId(request),
        typeof body.promoCode === "string" ? body.promoCode : undefined,
      ),
    };
  }

  @Get(":id/postal-shipment")
  async get(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    return { shipment: await this.shipping.get(caseId, this.userId(request)) };
  }

  @Post(":id/postal-shipment/refresh")
  async refresh(
    @Param("id") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return {
      shipment: await this.shipping.refresh(caseId, this.userId(request)),
    };
  }

  private userId(request: AuthenticatedRequest): string {
    if (!request.user) throw new UnauthorizedException("Session requise.");
    return request.user.id;
  }
}

@Controller("shipping/service-postal")
export class ServicePostalWebhookController {
  constructor(private readonly shipping: ShippingService) {}

  @Post("webhook")
  async webhook(
    @Body() payload: Record<string, unknown>,
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-service-postal-signature") signature: string | undefined,
    @Headers("x-service-postal-timestamp") timestamp: string | undefined,
    @Query("token") token: string | undefined,
  ) {
    return this.shipping.handleServicePostalWebhook(payload, {
      rawBody: request.rawBody,
      signature,
      timestamp,
      legacyToken: token,
    });
  }
}
