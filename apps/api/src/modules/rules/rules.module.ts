import { Module } from "@nestjs/common";
import { DocumentsModule } from "../documents/documents.module";
import { IdentityModule } from "../identity/identity.module";
import { GamesController } from "./games.controller";
import { AutomationRulesController } from "./automation-rules.controller";
import { RulesController } from "./rules.controller";
import { RulesService } from "./rules.service";

@Module({
  imports: [DocumentsModule, IdentityModule],
  controllers: [RulesController, GamesController, AutomationRulesController],
  providers: [RulesService],
})
export class RulesModule {}
