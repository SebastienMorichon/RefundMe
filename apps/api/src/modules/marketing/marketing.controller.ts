import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../identity/admin.guard";
import { AuthGuard } from "../identity/auth.guard";
import { MarketingService } from "./marketing.service";

@Controller("admin/marketing")
@UseGuards(AuthGuard, AdminGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get("funnel")
  async funnel() {
    return this.marketing.getFunnelOverview();
  }
}
