import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { IdentityModule } from "../identity/identity.module";
import { EligibilityController } from "./eligibility.controller";
import { EligibilityService } from "./eligibility.service";

@Module({
  imports: [DocumentsModule, IdentityModule],
  controllers: [EligibilityController],
  providers: [EligibilityService],
})
export class EligibilityModule {}
