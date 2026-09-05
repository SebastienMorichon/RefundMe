import {
  Controller,
  Headers,
  Param,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthGuard } from "../identity/auth.guard";
import type { AuthenticatedRequest } from "../identity/auth.types";
import { PaymentsService } from "./payments.service";

@Controller("cases")
@UseGuards(AuthGuard)
export class CasePaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post(":id/checkout-session")
  async createCheckout(@Param("id") caseId: string, @Req() request: AuthenticatedRequest) {
    if (!request.user) {
      throw new UnauthorizedException("Session requise.");
    }

    return this.payments.createCheckoutSession(caseId, request.user.id);
  }
}

@Controller("payments")
export class StripeWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("stripe/webhook")
  async receiveStripeWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers("stripe-signature") signature?: string,
  ) {
    return this.payments.handleStripeWebhook(request.rawBody, signature);
  }
}
