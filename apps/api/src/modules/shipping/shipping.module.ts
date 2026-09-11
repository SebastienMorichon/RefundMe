import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { DocumentsModule } from "../documents/documents.module";
import { PacketsModule } from "../packets/packets.module";
import {
  ServicePostalWebhookController,
  ShippingController,
} from "./shipping.controller";
import { ShippingService } from "./shipping.service";
import { AdminFulfillmentController } from "./admin-fulfillment.controller";

@Module({
  imports: [IdentityModule, DocumentsModule, PacketsModule],
  controllers: [
    ShippingController,
    ServicePostalWebhookController,
    AdminFulfillmentController,
  ],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
