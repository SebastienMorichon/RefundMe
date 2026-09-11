import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
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
export class SumUpWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Post("sumup/webhook")
  async receiveSumUpWebhook(@Body() payload: Record<string, unknown>) {
    return this.payments.handleSumUpWebhook(payload);
  }
}
