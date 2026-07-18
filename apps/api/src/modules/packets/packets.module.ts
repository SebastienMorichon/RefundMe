import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { IdentityModule } from "../identity/identity.module";
import { PacketsController } from "./packets.controller";
import { PacketsService } from "./packets.service";

@Module({
  imports: [IdentityModule, DocumentsModule],
  controllers: [PacketsController],
  providers: [PacketsService],
  exports: [PacketsService],
})
export class PacketsModule {}
