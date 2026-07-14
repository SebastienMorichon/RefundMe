import { Module } from "@nestjs/common";
import { DocumentsModule } from "./modules/documents/documents.module";
import { EligibilityModule } from "./modules/eligibility/eligibility.module";
import { HealthModule } from "./modules/health/health.module";
import { IdentityModule } from "./modules/identity/identity.module";
import { PrismaModule } from "./modules/prisma/prisma.module";
import { PaymentsModule } from "./modules/payments/payments.module";
import { PacketsModule } from "./modules/packets/packets.module";
import { RulesModule } from "./modules/rules/rules.module";

@Module({
  imports: [PrismaModule, HealthModule, IdentityModule, DocumentsModule, RulesModule, EligibilityModule, PaymentsModule, PacketsModule],
})
export class AppModule {}
