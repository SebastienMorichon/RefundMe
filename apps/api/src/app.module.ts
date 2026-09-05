import { Module } from "@nestjs/common";
import { DocumentsModule } from "./modules/documents/documents.module";
import { EligibilityModule } from "./modules/eligibility/eligibility.module";
import { HealthModule } from "./modules/health/health.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PricingModule } from "./modules/pricing/pricing.module";
import { PacketsModule } from "./modules/packets/packets.module";
import { RulesModule } from "./modules/rules/rules.module";
import { ShippingModule } from "./modules/shipping/shipping.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ContactModule } from "./modules/contact/contact.module";

@Module({
  imports: [
    PrismaModule,
    ContactModule,
    NotificationsModule,
    PricingModule,
    HealthModule,
    IdentityModule,
    DocumentsModule,
    RulesModule,
    EligibilityModule,
    PacketsModule,
    ShippingModule,
    PaymentsModule,
  ],
})
export class AppModule {}
