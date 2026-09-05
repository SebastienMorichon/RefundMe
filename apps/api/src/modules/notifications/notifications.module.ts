import { Global, Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Global()
@Module({
  imports: [IdentityModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
