import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";

@Module({
  imports: [IdentityModule],
  controllers: [RulesController],
  providers: [RulesService],
})
export class RulesModule {}
