import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { PacketsModule } from "../packets/packets.module";
import { ShippingController } from "./shipping.controller";
import { ShippingService } from "./shipping.service";

@Module({
  imports: [IdentityModule, PacketsModule],
  controllers: [ShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
