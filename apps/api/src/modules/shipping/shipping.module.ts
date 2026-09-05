import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { PacketsModule } from "../packets/packets.module";
import {
  ServicePostalWebhookController,
  ShippingController,
} from "./shipping.controller";
import { ShippingService } from "./shipping.service";

@Module({
  imports: [IdentityModule, PacketsModule],
  controllers: [ShippingController, ServicePostalWebhookController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
