import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { CasePaymentsController, StripeWebhookController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [IdentityModule],
  controllers: [CasePaymentsController, StripeWebhookController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
