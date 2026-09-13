import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { MarketingController } from "./marketing.controller";
import { MarketingService } from "./marketing.service";

@Module({
  imports: [IdentityModule],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
