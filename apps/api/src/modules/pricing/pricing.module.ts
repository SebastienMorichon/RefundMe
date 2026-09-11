import { Global, Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { PaymentConfigurationController, PricingController } from "./pricing.controller";
import { PricingService } from "./pricing.service";

@Global()
@Module({
  imports: [IdentityModule],
  controllers: [PricingController, PaymentConfigurationController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
