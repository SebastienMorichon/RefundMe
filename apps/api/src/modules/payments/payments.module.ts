import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { CasePaymentsController, SumUpWebhookController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { ShippingModule } from "../shipping/shipping.module";

@Module({
  imports: [IdentityModule, ShippingModule],
  controllers: [CasePaymentsController, SumUpWebhookController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
