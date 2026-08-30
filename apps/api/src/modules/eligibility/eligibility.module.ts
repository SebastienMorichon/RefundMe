import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { IdentityModule } from "../identity/identity.module";
import { EligibilityController } from "./eligibility.controller";
import { EligibilityService } from "./eligibility.service";
import { LocalPdfDlpService } from "../../platform/local-pdf-dlp.service";

@Module({
  imports: [DocumentsModule, IdentityModule],
  controllers: [EligibilityController],
  providers: [EligibilityService, LocalPdfDlpService],
})
export class EligibilityModule {}
