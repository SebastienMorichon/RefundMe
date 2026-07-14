import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { PacketsController } from "./packets.controller";
import { PacketsService } from "./packets.service";

@Module({
  imports: [IdentityModule],
  controllers: [PacketsController],
  providers: [PacketsService],
})
export class PacketsModule {}
